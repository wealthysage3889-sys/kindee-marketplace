require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const EMAIL = (process.argv[2] || "admin.shop@kindee.com").toLowerCase();

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI ไม่ได้ตั้งค่าใน backend/.env");

  await mongoose.connect(uri);
  const users = mongoose.connection.collection("users");

  const user = await users.findOne({ email: EMAIL });
  if (!user) {
    const all = await users.find({}, { projection: { email: 1, role: 1 } }).toArray();
    console.log(JSON.stringify({ success: false, message: `ไม่พบผู้ใช้ ${EMAIL}`, users: all }));
    process.exitCode = 1;
    return;
  }

  const result = await users.updateOne({ _id: user._id }, { $set: { role: "owner" } });
  const updated = await users.findOne({ _id: user._id }, { projection: { password: 0 } });
  console.log(
    JSON.stringify({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      user: updated,
    })
  );
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(process.exitCode || 0))
  .catch(async (err) => {
    console.error(err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });