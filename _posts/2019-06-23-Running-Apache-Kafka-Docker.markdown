---
layout: post
title:  "Running Apache Kafka on Docker"
date:   2019-06-23 22:37:08 +0530
---

Apache Kafka is an amazing tool! You can use it to send/recieve streams of data - in the millions. There is a lot of configuration that takes place, though.

For example, if you have a fresh OS install, you would have to:
- Download and install JRE/JDK
- Download and configure Zookeeper (which Kafka depends on to keep track of its nodes, topics, partitions, etc.)
- Download and configure Kafka (of course)
- Optionally, use third party tools like kafkat/optimist (which runs on ruby btw) to make things easier

![Apache Kafka](/assets/apache-kafka.png)

This, of course, would mess up your system if you only intend to use Kafka for one project (or at least temporarily). *Enter Docker!* You can install Kafka and dependencies on Docker and then use the endpoint in your producer/consumer using the address. But that doesn't work so smooth!

#### Getting Started
---

First, I pulled an ubuntu image

`docker pull ubuntu`

Installed the dependencies

`docker run -it < image id> /bin/bash -p 9092:9092 `  (Expose the ports that you'd be using later)

`root@5000f82fc450:/# apt-get install default-jre curl` (and others I might have missed)

Next, download and unzip the Kafka package from the [Download page](https://kafka.apache.org/downloads). Run zookeeper and Kafka after ensuring that the config files match your setup.

`~/kafka/bin# ./zookeeper-server-start.sh ../config/zookeeper.properties &  `

`~/kafka/bin# ./kafka-server-start.sh ../config/server.properties &      `

Create a topic with something like

`./kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic your-topic-name`

Test out everything by using the console producer and consumer.

`~/kafka/bin# ./kafka-console-producer.sh --broker-list:localhost:9092 --topic your-topic-name `  (and type a few messages)


`~/kafka/bin# ./kafka-console-consumer.sh --bootstrap-server localhost:9092 -topic your-topic-name --from-beginning ` (and check if you see them)

#### Communicate outside docker
---

If everything is okay, your consumer and producer, from within the docker container, are able to communicate with each other. While this is great, if you want to access Kafka from outside of docker, you'd have to take care of two things:
- Ensure the port is exposed.
- Ensure that you either have a hostfile entry with the containers hostname or configure kafka listeners correctly.

<div style="text-align: right"> 
![Docker](/assets/docker-small.png) 
</div>

To expose your port, you should have ideally run docker run with the expose port command (oops), but it is not too late to do that once the [container is already up](https://forums.docker.com/t/how-to-expose-port-on-running-container/3252/5). 


Second, when you try to connect to your Kafka from your hostmachine or from somewhere outside of Docker, you would run into a Docker networking issue - namely,

` <container id>:9092/0: Failed to resolve '<container id>:9092': No such host is known.`

This happens because kafka asks the host machine to listen to the default listener, which happens to be the hostname of the docker container (which is the container id) which the host machine does not recognize.

The easiest fix? Just add a hostfile entry on your host machine which redirects the hostname of the docker container to the localhost/host machine IP.

`127.0.0.1 <your container id>`

However, this isn't the best fix. This does not make the docker setup portable. In order to *actually* resolve the issue, you would have to ensure that you make use of the right listener environment variables for Kafka listeners, namely `KAFKA_ADVERTISED_LISTENERS`. 

`env KAFKA_ADVERTISED_LISTENERS="$HOSTNAME:9092, localhost:9092"`

This is of course, dependent on your environment and how exactly your network is set up. You can read more on listeners from here - https://rmoff.net/2018/08/02/kafka-listeners-explained/ 

