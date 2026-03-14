#!/bin/sh

set -eu

cp /etc/mongo-keyfile-source/keyfile /tmp/mongo-keyfile
chmod 600 /tmp/mongo-keyfile
chown mongodb:mongodb /tmp/mongo-keyfile

exec /usr/local/bin/docker-entrypoint.sh \
  mongod \
  --replSet rs0 \
  --bind_ip_all \
  --keyFile /tmp/mongo-keyfile
