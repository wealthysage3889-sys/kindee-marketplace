const mongoose = require("mongoose");
const Store = require("../models/Store");
const seedDefaultStore = require("../utils/seedDefaultStore");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Ensure UTF-8 encoding for Thai characters
      dbName: process.env.MONGO_DB_NAME,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    await seedDefaultStore();
    try {
      // Drop stale indexes (e.g. the old 2dsphere index on address.coordinates,
      // which rejects plain {lat,lng} values) and create current ones
      await Store.syncIndexes();
    } catch (indexError) {
      console.error(`Index sync skipped: ${indexError.message}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
