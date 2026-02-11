import Queue from 'bull';
import { runAlignmentPipeline } from '@/lib/pipeline';

const redisUrl = process.env.REDIS_URL;

export const alignmentQueue = redisUrl
  ? new Queue<{ jobId: string }>('alignment-jobs', redisUrl)
  : null;

let processorRegistered = false;

export function registerAlignmentProcessor() {
  if (!alignmentQueue || processorRegistered) {
    return;
  }

  alignmentQueue.process(async (job) => {
    await runAlignmentPipeline(job.data.jobId);
  });

  processorRegistered = true;
}

export async function enqueueAlignmentJob(jobId: string) {
  if (!alignmentQueue) {
    await runAlignmentPipeline(jobId);
    return;
  }

  registerAlignmentProcessor();
  await alignmentQueue.add({ jobId }, { attempts: 1, removeOnComplete: true, removeOnFail: false });
}
