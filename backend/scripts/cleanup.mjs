import mongoose from 'mongoose';

const uri = MONGODB_URI;

await mongoose.connect(uri);
const db = mongoose.connection.db;

const ur = await db.collection('features').updateMany({}, { $unset: { corrected_distance_ft: '' } });
console.log('Reset corrected_distance_ft on', ur.modifiedCount, 'features');

const jobs = await db.collection('alignmentjobs').countDocuments();
const features = await db.collection('features').countDocuments();
const runs = await db.collection('runs').countDocuments();
console.log('Remaining: jobs=' + jobs + ', features=' + features + ', runs=' + runs);

await mongoose.disconnect();
process.exit(0);
