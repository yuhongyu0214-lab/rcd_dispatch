const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: "admin@dispatch.dev" },
    update: {
      phone: "13800000000",
      name: "默认管理员",
      password: "admin123",
      role: "admin"
    },
    create: {
      email: "admin@dispatch.dev",
      phone: "13800000000",
      name: "默认管理员",
      password: "admin123",
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
