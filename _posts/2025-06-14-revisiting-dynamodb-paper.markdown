---
layout: post
title:  "DynamoDB: Notes on Operating a Managed NoSQL Service at Scale"
date:   2025-06-14 10:00:00 +0700
tags: [paper, aws, dynamodb]
---

I've been wanting to re-read the DynamoDB paper for a while now. Not the original Dynamo paper from 2007, but the newer one is from 2022: "Amazon DynamoDB: A Scalable, Predictably Performant, and Fully Managed NoSQL Database Service". This paper is fascinating because it shows how the ideas from the original Dynamo evolved into a managed service that handles trillions of API calls during Prime Day. It's one of those papers that gives you a glimpse into what it really takes to operate distributed systems at massive scale.


### Why This Paper is Different

The original Dynamo paper was about building a highly available key-value store. This paper is about something much harder: turning those ideas into a fully managed service that hundreds of thousands of customers rely on. The shift from "here's how to build a distributed database" to "here's how to operate one at scale without customers even thinking about it" is profound.

During the 2021 Prime Day, DynamoDB handled 89.2 million requests per second while maintaining single-digit millisecond latency. That's not just about having good algorithms—it's about operational excellence at a scale most of us can't even imagine.

### The Journey from Provisioned to On-Demand

One of the most interesting parts of the paper is how DynamoDB evolved from provisioned capacity to on-demand tables. Initially, customers had to specify read and write capacity units (RCUs and WCUs). This seemed reasonable: you tell us what you need, we'll make sure you get it.

But reality hit hard. Applications don't have uniform access patterns. You might have a partition getting hammered while others sit idle. The paper describes two major problems:

#### Hot Partitions and Throughput Dilution

Hot partitions occurred when traffic concentrated on a few items. Even worse was throughput dilution, when a partition split for size, its allocated throughput would be divided among child partitions. Imagine provisioning 1000 WCUs but getting throttled because one partition only got 250 WCUs after splits.

The initial fixes were clever hacks:
- Let partitions use unused capacity on a best-effort basis
- Detect throttling and boost partition capacity reactively

But these were band-aids. The real solution was more radical.

#### Global Admission Control

DynamoDB replaced partition-level admission control with global admission control (GAC - not to be confused with GAC from the dotnet world!). Instead of each partition managing its own capacity, request routers maintain local token buckets and coordinate with a central GAC service. This lets non-uniform workloads use up to the maximum partition capacity without complex distributed coordination.

The elegance here is that GAC maintains only ephemeral state—it can be restarted without impact. It's statically stable, a design principle I love.


### Durability Through Defense in Depth

The paper's approach to durability is paranoid in the best way. They assume everything will fail and build accordingly:

#### Write-Ahead Logs Everywhere

Not just on storage replicas, but also on dedicated log replicas that only store recent writes. When a storage node fails, adding a log replica takes seconds instead of minutes. This quick healing is crucial for maintaining durability during failures.

#### Continuous Verification

My favorite part: DynamoDB continuously verifies data at rest. The scrub process checks that:
1. All three replicas have identical data
2. Live replicas match replicas rebuilt from archived logs

They literally rebuild replicas from the complete history of archived logs and compare checksums. This has caught hardware failures, silent corruption, and even software bugs.

#### Checksums on Everything

Every log entry, every message, every file gets checksummed. The paper mentions this almost casually, but the discipline required to maintain this across a system of this scale is remarkable.


### Achieving High Availability

The availability numbers are staggering: 99.999% for global tables. Here's how they do it:

#### Sophisticated Failure Detection

Gray failures are the worst, that is, when a node is partially failed but not completely dead. DynamoDB's solution is elegant: before triggering a leader election, replicas ask each other "can you talk to the leader?" This simple check dramatically reduced false-positive failure detections.

#### MemDS: In-Memory Metadata Service

The metadata service evolution is a masterclass in removing single points of failure. Originally, routing information was cached locally with a 99.75% hit rate. Sounds good, right? But that 0.25% miss rate meant cold starts could overwhelm the metadata service.

The solution was MemDS, which stores all metadata in memory across a fleet. Here's the clever bit: even cache hits trigger async refreshes. This ensures constant load on MemDS regardless of cache hit rates, preventing the thundering herd problem.

#### Static Stability

Dependencies like IAM and KMS are in the critical path, but DynamoDB caches their responses and continues operating even when these services are down. The system degrades gracefully—new clients might have issues, but existing ones keep working.


### Lessons That Hit Different

Reading this paper in 2025, several things stand out:

1. DynamoDB explicitly optimizes for predictable latency, not the best possible latency. This is counterintuitive but absolutely correct for a managed service.

2. They use TLA+ to verify their replication protocol. When you're running millions of Paxos groups, you can't just hope your implementation is correct.

3. Moving from partition-level to global admission control, evolving the metadata service—these migrations are way harder than the initial implementation.

4. Because DynamoDB has a simple key-value API, they can do incredibly sophisticated things under the hood without breaking customers.

5. At scale, hardware failures aren't exceptions—they're Tuesday. The system must handle node failures, disk failures, and even entire AZ failures without customers noticing.


The hard part isn't building a distributed database, its operating one as a managed service where customers never have to think about partitions, replicas, or failures. Features like automatic scaling based on traffic patterns, splitting partitions based on actual access patterns (not just size), and maintaining consistent performance as tables grow from megabytes to petabytes—this is the real innovation.

The fact that during deployments, leader nodes gracefully relinquish leadership to avoid any availability impact—that's the kind of operational excellence that separates a research project from a production service.

Re-reading this paper reminded me that distributed systems papers often focus on algorithms and protocols, but the real challenges are operational. How do you deploy new code safely? How do you handle customer workloads that violate all your assumptions? How do you debug issues across millions of servers? This paper provides a rare glimpse into those challenges. 

If you're building or operating distributed systems, this paper is required reading. Not for the algorithms (though those are good too), but for the operational wisdom embedded in every section. 

#### Paper Link: [https://assets.amazon.science/33/9d/b77f13fe49a798ece85cf3f9be6d/amazon-dynamodb-a-scalable-predictably-performant-and-fully-managed-nosql-database-service.pdf](https://assets.amazon.science/33/9d/b77f13fe49a798ece85cf3f9be6d/amazon-dynamodb-a-scalable-predictably-performant-and-fully-managed-nosql-database-service.pdf)