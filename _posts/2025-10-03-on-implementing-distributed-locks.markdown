---
layout: post
title:  "On implementing distributed locks"
date:   2025-10-03 10:00:00 +0700
tags: [redis, distributed-systems, concurrency, locks, engineering]
---

I've been thinking about distributed locks lately. Not because they're particularly exciting, but because they're one of those problems that seems simple until you actually try to implement them correctly. You need to prevent two processes from doing the same thing at the same time, across multiple machines. How hard could it be?

Turns out, it's pretty hard.

The classic scenario: you have a distributed cron job that should only run once across your entire stack. Or maybe you're processing payments and need to ensure only one service instance handles a specific transaction at any given time. Local locks won't help you because you need coordination across machines.


### Why Redis for Distributed Locks?

Before the flamewar starts on the mention of the word 'Redis', know that there are options. Zookeeper is the enterprise choice, battle-tested and reliable. As is Consul. But Redis has a compelling advantage: you probably already have it. If not, replace all mentions of Redis with Valkey which is more permissive and open source.

Redis is fast, supports atomic operations which make implementing locks very easy. The key insight is that Redis's `SET` command can atomically set a key only if it doesn't exist, with an automatic expiration. That's basically a lock primitive right there.

```javascript
// The basic idea
await redis.set('my-lock', 'token', 'NX', 'PX', 10000);
// where
// NX: only set if not exists
// PX: expiration in milliseconds
```

Simple, right? But as always with distributed systems, the devil is in the details.


### How Redis Locks Actually Work

The fundamental operation is `SET key value NX PX milliseconds`. This command does three things atomically:
1. Sets the key only if it doesn't already exist (NX)
2. Sets an expiration time (PX)
3. Returns OK if it succeeded, nil if the key already existed

Here's a basic lock implementation in TypeScript:

```typescript
class RedisLock {
  private redis: Redis;
  private lockKey: string;
  private lockValue: string;
  private ttl: number;

  constructor(redis: Redis, resourceName: string, ttl: number = 10000) {
    this.redis = redis;
    this.lockKey = `lock:${resourceName}`;
    this.lockValue = crypto.randomUUID(); // unique token
    this.ttl = ttl;
  }

  async acquire(): Promise<boolean> {
    const result = await this.redis.set(
      this.lockKey,
      this.lockValue,
      'NX',
      'PX',
      this.ttl
    );
    return result === 'OK';
  }

  async release(): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, this.lockKey, this.lockValue);
  }
}
```

Why Lua script though instead of just `DEL` from the SDK? You can't just delete the key - what if your lock expired and someone else acquired it? The Lua script ensures you only delete the lock if you still own it. (How does Redis check ownership? By signing every lock with unique client string!)


### The Redlock Algorithm

The single instance approach works fine for many use cases, but what about when Redis itself fails? This is where things get interesting.

Salvatore Sanfilippo (antirez), Redis's creator, proposed the `Redlock` algorithm. 

The idea: instead of using a single Redis instance, use an odd number of independent instances (typically 5). 

To acquire a lock:

1. Get the current time in milliseconds
2. Try to acquire the lock on all N instances sequentially
3. Calculate how long acquisition took
4. Consider the lock acquired only if:
   - You got it on the majority of instances (N/2 + 1)
   - The total acquisition time is less than the lock validity time

You also need to account for the drift between system clocks for each redis instance. 

```typescript
class Redlock {
  private instances: Redis[];
  private quorum: number;

  constructor(instances: Redis[]) {
    this.instances = instances;
    this.quorum = Math.floor(instances.length / 2) + 1;
  }

  async acquire(resource: string, ttl: number): Promise<Lock | null> {
    const token = crypto.randomUUID();
    const startTime = Date.now();
    const driftFactor = 0.01; // 1% drift
    const drift = Math.round(ttl * driftFactor) + 2;

    let successCount = 0;
    const promises = this.instances.map(async (redis) => {
      try {
        const result = await redis.set(
          `lock:${resource}`,
          token,
          'NX',
          'PX',
          ttl
        );
        return result === 'OK';
      } catch (err) {
        return false;
      }
    });

    const results = await Promise.all(promises);
    successCount = results.filter(r => r).length;

    const elapsed = Date.now() - startTime;
    const validityTime = ttl - elapsed - drift;

    if (successCount >= this.quorum && validityTime > 0) {
      return { token, validityTime };
    }

    await this.release(resource, token);
    return null;
  }
}
```

The drift calculation is crucial. Clocks on different machines aren't perfectly synchronized. If your lock has a 10-second TTL but clock drift is 2 seconds, you can't assume you have the full 10 seconds.


### Martin Kleppmann's Critique

Martin Kleppmann (shoutout to the epic Designing Data Intensive Applications!) wrote a popular argu,ent against Redlock, arguing that it doesn't provide the safety guarantees you might think it does.

His main points:
1. Clock drift and process pauses (like GC pauses) can cause you to think you hold a lock when you don't
2. Redlock doesn't provide fencing tokens to prevent this

What a fencing token, you ask? Imagine:
1. Client A acquires the lock
2. Client A experiences a long GC pause
3. The lock expires
4. Client B acquires the lock
5. Client A wakes up, thinks it still has the lock, proceeds to modify shared resource
6. Both clients are now modifying the same resource

Antirez's/Redis committee's response was essentially: Redlock is for efficiency, not correctness. If you need absolute correctness, use a consensus system like Zookeeper. But for many practical applications-preventing duplicate cron jobs, avoiding unnecessary work-Redlock is fine.


### Production Considerations

In production, you need to think beyond just acquiring and releasing locks.

#### Lock Extension

What if your work takes longer than expected? You need to extend the lock:

```typescript
async extend(additionalTime: number): Promise<boolean> {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;
  const result = await this.redis.eval(
    script,
    1,
    this.lockKey,
    this.lockValue,
    additionalTime
  );
  return result === 1;
}
```

#### Retry Logic

You usually don't want to fail immediately if you can't acquire a lock. You could implement retry with exponential backoff:

```typescript
async acquireWithRetry(
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await this.acquire()) {
      return true;
    }
    const delay = baseDelay * Math.pow(2, i) + Math.random() * 100;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return false;
}
```

#### Sharing with Read-Write Locks

Sometimes you want multiple readers but exclusive writers. Redis doesn't have this built-in, but you can implement it like so.

One common approach to guarantee consistency is to only allow writes when there are no reader locks. 

```typescript
class RWLock {
  async acquireRead(resource: string): Promise<boolean> {
    const script = `
      if redis.call("get", "write:" .. KEYS[1]) then
        return 0
      else
        return redis.call("incr", "read:" .. KEYS[1])
      end
    `;
    const result = await this.redis.eval(script, 1, resource);
    return result > 0;
  }

  async acquireWrite(resource: string): Promise<boolean> {
    const script = `
      if redis.call("get", "read:" .. KEYS[1]) or
         redis.call("get", "write:" .. KEYS[1]) then
        return 0
      else
        return redis.call("set", "write:" .. KEYS[1], "1", "NX", "PX", ARGV[1])
      end
    `;
    const result = await this.redis.eval(script, 1, resource, this.ttl);
    return result === 'OK';
  }
}
```

But wait, does this mean we would need to wait for no more read locks before exclusive write locks are obtained? What if your application is read intensive? Would that mean infinite time to update locks? 

Based on the above implementation, yes. But we could make locking fair with queues to solve this. 

#### Making Locking fair

The basic implementation above is what you could call unfair.
Lets say if a client acquired a lock and then released it, it could immediately reacquire it,  other clients would be starved. 

For fairness, we need to implement a queue. Luckily, we don't need to implement or adopt another system like rabbitmq or Kafka, redis comes with an inbuilt queue. 

```typescript
async acquireFair(resource: string): Promise<boolean> {
  const queueKey = `queue:${resource}`;
  const lockKey = `lock:${resource}`;
  const token = crypto.randomUUID();

  await this.redis.zadd(queueKey, Date.now(), token);

  while (true) {
    // Check if we're first in queue
    const first = await this.redis.zrange(queueKey, 0, 0);
    if (first[0] !== token) {
      await sleep(100);
      continue;
    }

    // now, we try to acquire
    const acquired = await this.redis.set(lockKey, token, 'NX', 'PX', this.ttl);
    if (acquired === 'OK') {
      await this.redis.zrem(queueKey, token);
      return true;
    }
  }
}
```
### Alternatives to Redis

As mentioned before, there are many alternatives to redis. IN some cases, you don't even need Redis/In-Mem key value store. 

#### Database-Level Locks

If your core intention of acquiring locks is to make DB read/edits, and you use Postgres or MySQL (or modern DBs), you're gonna want to hear this. 

Advisory locks are provided by DB to allow control by application. For example, in Postgres, they're simple and easy to use. 

```sql
-- 12345 is a unique 64 bit number
SELECT pg_advisory_lock(12345);
-- do work
SELECT pg_advisory_unlock(12345);
```

Once you acquire the lock, you cannot reacquire the lock unless the session releases it. This can be used in your application, for example, by assigning actions to the same lock ID. 

#### Optimistic Concurrency

You may not even need locks in some cases. For many use cases, compare-and-swap is better than locks. 

For example, if you want to update an order:

```sql
UPDATE orders
SET status = 'processing', version = version + 1
WHERE id = 123 AND version = 5;
```

If the update affects 0 rows, someone else got there first. In that case, you can re-read and retry or abort. 

### Libraries Worth Using

Realistically speaking, you don't need to build your own implementation unless it's for self learning. 

These implementations are battle tested on production and almost always a better idea than building your own. These libraries handle edge cases you probably haven't thought of yet.

- **node-redlock** (Node.js): Full Redlock implementation with automatic extension
- **Redisson** (Java): Excellent Redis client with distributed locks, maps, queues, etc.
- **redlock-py** (Python): Python implementation of Redlock
- **go-redsync** (Go): Clean Go implementation


### Final Thoughts

Distributed locks are a tool, not a silver bullet. They work well for coordination in systems where:
- You need to prevent duplicate work
- Occasional failures are acceptable
- You need low latency
- You already have Redis

They're not appropriate when:
- You need absolute correctness
- You're protecting financial transactions
- Failures have serious consequences
- You're better off with a proper consensus system

The 2022 Stack Overflow survey showed Redis is used by about 22% of professional developers. Many of those are using it for caching, but increasingly, teams are discovering its usefulness for coordination. The key is understanding the tradeoffs.

When I first implemented distributed locks, I thought the hard part was the code. It's not. The hard part is choosing the right TTL, handling edge cases gracefully, and building systems that degrade nicely when locks fail. Redis makes the easy parts easy, but the hard parts are still hard.


### References

1. Sanfilippo, S. (2015). **Distributed locks with Redis**. Redis Documentation. [https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)

2. Kleppmann, M. (2016, February 8). **How to do distributed locking**. Martin Kleppmann's Blog. [https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)

3. Sanfilippo, S. (2016, February 9). **Is Redlock safe?** Antirez Weblog. [http://antirez.com/news/101](http://antirez.com/news/101)
