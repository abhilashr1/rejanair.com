---
layout: post
title:  "Building Kafka from Scratch in Go (Part 1)"
date:   2026-03-19 10:00:00 +0530
tags: [kafka, go, distributed-systems, engineering, from-scratch]
---

Kafka is one of those systems that's just everywhere. If you've worked on anything involving event streaming, async processing, or data pipelines, you've probably produced to a Kafka topic, consumed from one, or stared at consumer lag dashboards wondering why your consumer group is falling behind. I've done all three more times than I'd like.

But I realized I'd never really looked at how Kafka works under the hood. I knew the basics  topics, partitions, consumer groups -- but not why it's so fast, or how an append-only log on disk can outperform most in-memory message queues. So I decided to build one from scratch.

This is Part 1 of that journey. I'll explore the core ideas behind Kafka, why its design choices make it so fast, and start writing the foundational code in Go. By the end, we'll have something that can append records to a log and read them back. It won't be pretty, fair warning.

### What Kafka Actually Is

The first thing to understand is that Kafka is not a traditional message queue. Systems like RabbitMQ or SQS follow a consume-and-delete model: a producer pushes a message, a consumer pops it, acknowledges it, and the message is gone. Kafka doesn't work like that at all.

Kafka is a distributed commit log. The original paper by Jay Kreps, Neha Narkhede, and Jun Rao at LinkedIn (2011) describes it as "a distributed messaging system for log processing," but the key word is *log*. A Kafka topic is fundamentally an append-only, ordered sequence of records. Producers append to the end. Consumers read from wherever they want. Records are not removed after consumption they stick around until a configurable retention period expires.

This is a subtle but important distinction. In a traditional queue, once a consumer reads a message, it's gone. If another service wants that same data, tough luck. In Kafka, the data just sits there. Multiple consumer groups can independently read the same topic at different speeds, from different positions. One group might be processing real-time events while another replays last week's data for a backfill. Neither affects the other.

Jay Kreps wrote a fantastic blog post in 2013 called "The Log: What every software engineer should know about real-time data's unifying abstraction." The core idea is that an append-only log is the most fundamental data structure in distributed systems, becasue it captures what happened and in what order. Databases use write-ahead logs. Consensus protocols use replicated logs. Kafka just makes the log the primary abstraction and builds everything else on top.

This design also means Kafka can decouple producers and consumers completely. The producer doesn't care who's reading. The consumer doesn't care who's writing. They only share the log, and the log doesn't care about either of them. It just grows.


### Core Concepts

Before writing any code, it's worth getting the terminology straight. Kafka has a handful of core concepts that everything else builds on.

**Topics** are named streams of records. You produce to a topic, you consume from a topic. 

Each topic is split into one or more **partitions**, and each partition is an independent, ordered, append-only log. When you produce a message with a key, Kafka hashes the key to determine which partition it goes to. Messages with the same key always land in the same partition, which guarantees ordering per key. Without a key, messages are distributed round-robin across partitions.

Partitions are the unit of parallelism in Kafka. More partitions means more consumers can read concurrently. It's how Kafka scales horizontally.

**Brokers** are the servers that make up a Kafka cluster. Each broker stores some set of partitions. A partition has one leader broker that handles all reads and writes, and zero or more follower brokers that replicate the data for fault tolerance.

**Producers** write records to topics. They can choose to write to a specific partition (via key hashing) or let Kafka distribute across partitions. Producers can also batch records together before sending, which significantly improves throughput.

**Consumers** read records from partitions. Each consumer tracks its position in the partition using an **offset** a monotonically increasing integer assigned to each record as it's appended. The consumer decides where to start reading (beginning, end, or any specific offset) and advances at its own pace.

**Consumer Groups** coordinate multiple consumers. Within a group, each partition is assigned to exactly one consumer. If you have 6 partitions and 3 consumers in a group, each consumer gets 2 partitions. If a consumer crashes, its partitions get reassigned to surviving consumers. Different consumer groups are completely independent, they each maintain their own offsets and read at their own pace.

Instead of tracking which individual messages have been acknowledged (like traditional queues do), Kafka just stores a single integer per partition per consumer group: "I've processed everything up to offset 42." 

### Let's Build It

Time to write some Go. We'll start with the core data structures and a basic append-read cycle. 

First, the fundamental types:

```go
type Record struct {
	Offset    uint64
	Timestamp int64
	Key       []byte
	Value     []byte
}

type Segment struct {
	baseOffset uint64
	nextOffset uint64
	file       *os.File
	size       int64
	mu         sync.Mutex
}

type Partition struct {
	id       int
	segments []*Segment
	active   *Segment
	dir      string
	mu       sync.RWMutex
}

type Topic struct {
	name       string
	partitions []*Partition
}

type Broker struct {
	topics map[string]*Topic
	addr   string
	mu     sync.RWMutex
}
```

These map directly to the concepts above. A `Record` is a single message. A `Segment` is a chunk of the log backed by a file on disk. A `Partition` manages a sequence of segments. A `Topic` holds partitions. A `Broker` ties it all together.

Now the core idea, which is, appending to the log:

```go
func (s *Segment) Append(record Record) (uint64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record.Offset = s.nextOffset

	data, err := encode(record)
	if err != nil {
		return 0, err
	}

	n, err := s.file.Write(data)
	if err != nil {
		return 0, err
	}

	offset := s.nextOffset
	s.nextOffset++
	s.size += int64(n)
	return offset, nil
}
```

The `encode` function serializes the record into a simple binary format, length-prefixed key and value, plus the offset and timestamp. The important thing is that we always write to the end of the file. Sequential writes only. 

At the partition level, we need to handle segment rolling, creating a new segment when the current one gets too big:

```go
const MaxSegmentBytes = 1024 * 1024 * 100 // 100MB

func (p *Partition) Append(key, value []byte) (uint64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.active.size >= MaxSegmentBytes {
		seg, err := p.newSegment(p.active.nextOffset)
		if err != nil {
			return 0, err
		}
		p.segments = append(p.segments, seg)
		p.active = seg
	}

	record := Record{
		Timestamp: time.Now().UnixNano(),
		Key:       key,
		Value:     value,
	}

	return p.active.Append(record)
}
```

When the active segment crosses 100MB, we roll to a new one. The new segment's base offset starts where the old one left off. Old segments stay on disk for reads until retention kicks in.

Reading is the reverse, we find the right segment, and then seek to the right position:

```go
func (p *Partition) ReadFrom(offset uint64, maxRecords int) ([]Record, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	seg := p.findSegment(offset)
	if seg == nil {
		return nil, fmt.Errorf("offset %d not found", offset)
	}

	return seg.ReadAt(offset, maxRecords)
}

func (p *Partition) findSegment(offset uint64) *Segment {
	for i := len(p.segments) - 1; i >= 0; i-- {
		if p.segments[i].baseOffset <= offset {
			return p.segments[i]
		}
	}
	return nil
}
```

We walk backwards through segments to find the one containing our offset. In a real implementation, you'd use the `.index` file for O(1) lookups instead of scanning. We'll get to that (someday).

Finally, a bare-bones TCP server to accept produce and consume requests:

```go
func (b *Broker) Start() error {
	ln, err := net.Listen("tcp", b.addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	log.Printf("broker listening on %s", b.addr)

	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("accept error: %v", err)
			continue
		}
		go b.handleConnection(conn)
	}
}

func (b *Broker) handleConnection(conn net.Conn) {
	defer conn.Close()
	reader := bufio.NewReader(conn)

	for {
		cmd, err := readCommand(reader)
		if err != nil {
			return
		}

		switch cmd.Type {
		case CmdProduce:
			b.handleProduce(conn, cmd)
		case CmdConsume:
			b.handleConsume(conn, cmd)
		}
	}
}
```

And the produce/consume handlers themselves:

```go
func (b *Broker) handleProduce(conn net.Conn, cmd Command) {
	b.mu.RLock()
	topic, exists := b.topics[cmd.Topic]
	b.mu.RUnlock()

	if !exists {
		topic = b.createTopic(cmd.Topic, 3) 
	}

	partIdx := int(hash(cmd.Key)) % len(topic.partitions)
	partition := topic.partitions[partIdx]

	offset, err := partition.Append(cmd.Key, cmd.Value)
	if err != nil {
		writeError(conn, err)
		return
	}

	writeProduceResponse(conn, offset)
}

func (b *Broker) handleConsume(conn net.Conn, cmd Command) {
	b.mu.RLock()
	topic, exists := b.topics[cmd.Topic]
	b.mu.RUnlock()

	if !exists {
		writeError(conn, fmt.Errorf("topic %s not found", cmd.Topic))
		return
	}

	partition := topic.partitions[cmd.Partition]
	records, err := partition.ReadFrom(cmd.Offset, cmd.MaxRecords)
	if err != nil {
		writeError(conn, err)
		return
	}

	writeConsumeResponse(conn, records)
}
```

Notice that key-based partition routing means all records with the same key go to the same partition. This is how Kafka guarantees ordering per key;

Real Kafka uses a sophisticated binary protocol with request/response correlation IDs, API versioning, and a lot more message types. We're using a simple command struct here to keep the focus on the storage layer.


### What's Missing and What's Next

Quite a lot, honestly. This skeleton doesn't have:

- If the broker crashes, the data is gone. Real Kafka replicates each partition across multiple brokers using a leader-follower model.
- Right now consumers track their own offsets. Real Kafka stores committed offsets in an internal topic (`__consumer_offsets`) and handles group coordination, partition assignment, and rebalancing.
- We're walking segments linearly to find an offset. Real Kafka maintains `.index` files for O(1) offset lookups within a segment using binary search. Real world performance would absolutely suck. 
- Real Kafka clients speak a well-defined binary protocol over TCP with dozens of API types. Our command struct is a toy implemenation, as much as it hurts me to say. 
- Compression, authentication, quotas, exactly-once semantics, ...

But we have something. About 200 lines of Go that can append records to a partitioned, segmented, append-only log and read them back.


### References

1. Kreps, J., Narkhede, N., & Rao, J. (2011). **Kafka: a Distributed Messaging System for Log Processing**. NetDB Workshop. [https://notes.stephenholiday.com/Kafka.pdf](https://notes.stephenholiday.com/Kafka.pdf)

2. Kreps, J. (2013). **The Log: What every software engineer should know about real-time data's unifying abstraction**. LinkedIn Engineering Blog. [https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)

3. Apache Kafka Documentation. **Design**. [https://kafka.apache.org/documentation/#design](https://kafka.apache.org/documentation/#design)
