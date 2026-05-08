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

  const shanghaiStore = await prisma.store.upsert({
    where: { code: "STORE_SH_HQ" },
    update: {
      name: "上海虹桥店",
      isActive: true
    },
    create: {
      code: "STORE_SH_HQ",
      name: "上海虹桥店"
    }
  });

  const hangzhouStore = await prisma.store.upsert({
    where: { code: "STORE_HZ_XH" },
    update: {
      name: "杭州西湖店",
      isActive: true
    },
    create: {
      code: "STORE_HZ_XH",
      name: "杭州西湖店"
    }
  });

  await prisma.driver.upsert({
    where: { phone: "13800000001" },
    update: {
      storeId: shanghaiStore.id,
      name: "张伟",
      status: "S1",
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      name: "张伟",
      phone: "13800000001",
      status: "S1"
    }
  });

  await prisma.driver.upsert({
    where: { phone: "13800000002" },
    update: {
      storeId: shanghaiStore.id,
      name: "李娜",
      status: "S2",
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      name: "李娜",
      phone: "13800000002",
      status: "S2"
    }
  });

  await prisma.driver.upsert({
    where: { phone: "13800000003" },
    update: {
      storeId: hangzhouStore.id,
      name: "王强",
      status: "S1",
      isActive: true
    },
    create: {
      storeId: hangzhouStore.id,
      name: "王强",
      phone: "13800000003",
      status: "S1"
    }
  });

  await prisma.vehicle.upsert({
    where: { licensePlate: "沪A12345" },
    update: {
      storeId: shanghaiStore.id,
      vehicleType: "SUV",
      status: "AVAILABLE",
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      licensePlate: "沪A12345",
      vehicleType: "SUV",
      status: "AVAILABLE"
    }
  });

  await prisma.vehicle.upsert({
    where: { licensePlate: "浙A67890" },
    update: {
      storeId: hangzhouStore.id,
      vehicleType: "SEDAN",
      status: "AVAILABLE",
      isActive: true
    },
    create: {
      storeId: hangzhouStore.id,
      licensePlate: "浙A67890",
      vehicleType: "SEDAN",
      status: "AVAILABLE"
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
