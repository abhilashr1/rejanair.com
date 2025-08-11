---
layout: post
title:  "LinkedIn InSearch: Engineering Private Messaging Search at Scale"
date:   2025-08-11 10:00:00 +0700
tags: [paper, linkedin, search, distributed-systems, privacy, engineering]
---

I've been diving into LinkedIn's engineering blog posts lately, and their InSearch platform caught my attention. Not because it's another search system, but because it tackles a uniquely challenging problem: how do you build search for private messaging data at massive scale while maintaining strict privacy guarantees? This is the kind of engineering challenge that keeps distributed systems engineers up at night.

As someone who's worked with search before, I know that messaging search is pretty hard. We're not just dealing with public data that can be indexed once and served to millions, but also handling confidential conversations that are encrypted, searchable only by their owners, and deletable on request.


### Why Messaging Search is Different

Think about regular web search for a moment. You crawl public data, build massive inverted indexes, and serve queries from these shared indexes. Simple, right? But this doesn't apply to search.

Messaging search is different.
- Each user's messages are private and can't be mixed with others
- Data must be encrypted at rest—no plaintext sitting around
- Users expect instant search results on years of conversation history
- The query-to-message ratio is extremely low (people search messages way less than they write them)

### InSearch Architecture

InSearch's architecture is different, because instead of building massive shared indexes, they went with per-member indexing. Here's the difference - they don't actually maintain persistent indexes for every user.

#### Store Encrypted but Index On-Demand

Insight stores each raw document encrypted in a key-value store (they use RocksDB, btw), with the key being a combination of memberId and documentId (`memberId + documentId`). When a member performs their first search:

1. Run a prefix scan to get all documents for that member
2. Decrypt the documents and build a Lucene index on-the-fly (!!)
3. Cache the index in memory for subsequent searches
4. Achieve a 90% cache hit ratio in production

This approach solves multiple problems at once. You get encryption at rest for free, you don't waste resources indexing messages for users who never search, and you can easily delete user data when needed.

#### The Performance Numbers

What really impressed me were the performance characteristics:
- 99th percentile latency around 150ms
- 90% cache hit ratio
- Three live replicas per searcher partition
- One backup replica with HDFS snapshots

The numbers are pretty good for a system handling encrypted, personalized data. Most search systems with similar constraints would be happy with sub-second latencies.


### Key Decisions

Reading through the technical details, several design decisions stand out as particularly smart:

#### Kafka Streams for Ingestion

They use Kafka streams for data ingestion, which makes perfect sense. Messages are inherently stream-oriented data, and with Kafka they can replay message history if needed. This also decouples message writing from indexing, allowing the system to handle traffic spikes gracefully.

#### Sticky Routing for Consistency

They implement sticky routing to ensure users get consistent search results. When your index is cached in memory across multiple nodes, you want the same user to hit the same node repeatedly. This maximizes cache efficiency and provides a better user experience.

#### Horizontal Scaling Through Partitioning

The system scales horizontally through data partitioning. Each searcher partition handles a subset of members, and you can add more partitions as your user base grows.


### Privacy First

What sets InSearch apart from other search systems I've studied is how privacy is baked into the architecture:

1. All data is encrypted on disk. Not just "sensitive fields".

2. Indexes are built per-member and cached separately. There's no way for one user's search to accidentally surface another's messages.

3. When a user deletes a message or closes their account, the data can be cleanly purged from both the key-value store and any cached indexes.

4. The system enforces that members can only search their own messages.


### Some takeaways

1. From day one, think about how data will be deleted. InSearch's key-value store makes this trivial - delete the keys, and the data is gone.

2. By encrypting everything and building indexes on-demand, InSearch minimizes the amount of plaintext data sitting around waiting to be compromised.

3. Optimize use of caching, with stick sessions. 

4. Member data is isolated at the storage level, not just the application level. 


InSearch now seems to serve all message search requests. What strikes me about this system is how it manages to be boring in all the right ways. It uses proven technologies (Lucene, RocksDB, Kafka), implements well-understood patterns (sharding, caching, replication), but combines them in a way that solves a hard problem.


### References

1. Shah, S., & Shankar, H. (2020, March 17). **InSearch: LinkedIn's new message search platform**. LinkedIn Engineering Blog. [https://www.linkedin.com/blog/engineering/search/introducing-insearch](https://www.linkedin.com/blog/engineering/search/introducing-insearch)

2. LinkedIn Engineering. (2020). **Rebuilding messaging: How we bootstrapped our platform**. LinkedIn Engineering Blog. [https://engineering.linkedin.com/blog/2020/bootstrapping-our-new-messaging-platform](https://engineering.linkedin.com/blog/2020/bootstrapping-our-new-messaging-platform)

3. LinkedIn Engineering. (2019). **Privacy-Preserving Analytics and Reporting at LinkedIn**. LinkedIn Engineering Blog. [https://engineering.linkedin.com/blog/2019/04/privacy-preserving-analytics-and-reporting-at-linkedin](https://engineering.linkedin.com/blog/2019/04/privacy-preserving-analytics-and-reporting-at-linkedin)