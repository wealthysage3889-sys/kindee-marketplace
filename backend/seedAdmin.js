require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const seedAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB_NAME,
    });
    console.log("MongoDB Connected");

    const email = "admin.shop@kindee.com";
    const password = "123456";

    // Delete existing admin
    const deleted = await User.deleteOne({ email });
    console.log(`Deleted existing admin: ${deleted.deletedCount} document(s)`);

    // Hash password with bcryptjs (standard approach)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    console.log(`Password hashed: ${hashedPassword}`);

    // Create new admin using collection.insertOne to bypass pre-save hooks
    // (the User model's pre-save hook would double-hash the password otherwise)
    const result = await User.collection.insertOne({
      name: "Kindee Admin",
      email,
      password: hashedPassword,
      role: "admin",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("Admin created successfully:");
    console.log(`  ID: ${result.insertedId}`);
    console.log(`  Email: ${email}`);
    console.log(`  Role: admin`);

    // Verify password works
    const verifyMatch = await bcrypt.compare(password, hashedPassword);
    console.log(`  Password verification: ${verifyMatch ? "OK" : "FAILED"}`);
  } catch (error) {
    console.error("Error seeding admin:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("MongoDB Disconnected");
  }
};

seedAdmin();