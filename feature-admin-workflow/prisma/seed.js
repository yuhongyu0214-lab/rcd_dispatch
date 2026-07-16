const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function main() {
  const adminPasswordHash = await bcrypt.hash("admin123", SALT_ROUNDS);

  await prisma.user.upsert({
    where: { email: "admin@dispatch.dev" },
    update: {
      phone: "13800000000",
      name: "默认管理员",
      password: adminPasswordHash,
      role: "admin"
    },
    create: {
      email: "admin@dispatch.dev",
      phone: "13800000000",
      name: "默认管理员",
      password: adminPasswordHash,
      role: "admin"
    }
  });
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
