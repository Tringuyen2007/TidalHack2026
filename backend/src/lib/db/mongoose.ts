import mongoose from 'mongoose';

const mongodbUri = process.env.MONGODB_URI;

if (!mongodbUri) {
  throw new Error('Missing MONGODB_URI in environment');
}

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cached = global.mongooseCache ?? { conn: null, promise: null };
global.mongooseCache = cached;

export async function connectToDatabase() {
  if (!mongodbUri) {
    throw new Error('Missing MONGODB_URI in environment');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongodbUri, { bufferCommands: false });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}
