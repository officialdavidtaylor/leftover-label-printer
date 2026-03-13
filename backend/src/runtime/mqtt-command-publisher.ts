import mqtt, { type MqttClient } from 'mqtt';

import type { DispatchPrintJobCommandPublisher } from '../api/create-print-job.ts';

export async function connectMqttClient(config: {
  brokerUrl: string;
  username: string;
  password: string;
}): Promise<MqttClient> {
  return mqtt.connectAsync(config.brokerUrl, {
    username: config.username,
    password: config.password,
    reconnectPeriod: 1_000,
    connectTimeout: 10_000,
  });
}

export async function closeMqttClient(client: MqttClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.end(false, {}, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export class MqttPrintJobCommandPublisher implements DispatchPrintJobCommandPublisher {
  private readonly client: MqttClient;

  constructor(client: MqttClient) {
    this.client = client;
  }

  async publish(input: {
    topic: string;
    qos: 1;
    payload: {
      schemaVersion: string;
      type: 'print_job_dispatch';
      eventId: string;
      traceId: string;
      jobId: string;
      printerId: string;
      objectUrl: string;
      issuedAt: string;
    };
  }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.client.publish(input.topic, JSON.stringify(input.payload), { qos: input.qos }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}
