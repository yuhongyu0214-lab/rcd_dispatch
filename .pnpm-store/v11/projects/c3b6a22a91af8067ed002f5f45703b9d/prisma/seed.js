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
      gpsLat: 31.1977,
      gpsLng: 121.3275,
      status: "AVAILABLE",
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      licensePlate: "沪A12345",
      vehicleType: "SUV",
      gpsLat: 31.1977,
      gpsLng: 121.3275,
      status: "AVAILABLE"
    }
  });

  await prisma.vehicle.upsert({
    where: { licensePlate: "浙A67890" },
    update: {
      storeId: hangzhouStore.id,
      vehicleType: "SEDAN",
      gpsLat: 30.27415,
      gpsLng: 120.15515,
      status: "AVAILABLE",
      isActive: true
    },
    create: {
      storeId: hangzhouStore.id,
      licensePlate: "浙A67890",
      vehicleType: "SEDAN",
      gpsLat: 30.27415,
      gpsLng: 120.15515,
      status: "AVAILABLE"
    }
  });

  const shanghaiVehicle = await prisma.vehicle.findUnique({
    where: { licensePlate: "沪A12345" },
    select: { id: true, licensePlate: true }
  });

  const hangzhouVehicle = await prisma.vehicle.findUnique({
    where: { licensePlate: "浙A67890" },
    select: { id: true, licensePlate: true }
  });

  await prisma.order.upsert({
    where: { orderNo: "ORD-20260508-001" },
    update: {
      type: "STORE_PICKUP",
      status: "PENDING",
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店取车区",
      returnAddress: "上海浦东新区张江路 100 号",
      scheduledAt: new Date("2026-05-08T09:00:00+08:00")
    },
    create: {
      orderNo: "ORD-20260508-001",
      type: "STORE_PICKUP",
      status: "PENDING",
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店取车区",
      returnAddress: "上海浦东新区张江路 100 号",
      scheduledAt: new Date("2026-05-08T09:00:00+08:00")
    }
  });

  await prisma.order.upsert({
    where: { orderNo: "ORD-20260508-002" },
    update: {
      type: "DOOR_DELIVERY",
      status: "PENDING",
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店停车场",
      returnAddress: "上海市闵行区申长路 888 号",
      scheduledAt: new Date("2026-05-08T13:30:00+08:00")
    },
    create: {
      orderNo: "ORD-20260508-002",
      type: "DOOR_DELIVERY",
      status: "PENDING",
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店停车场",
      returnAddress: "上海市闵行区申长路 888 号",
      scheduledAt: new Date("2026-05-08T13:30:00+08:00")
    }
  });

  await prisma.order.upsert({
    where: { orderNo: "ORD-20260508-003" },
    update: {
      type: "STORE_RETURN",
      status: "PENDING",
      storeId: hangzhouStore.id,
      vehicleId: hangzhouVehicle?.id ?? null,
      licensePlateSnapshot: hangzhouVehicle?.licensePlate ?? null,
      pickupAddress: "杭州市西湖区文三路 90 号",
      returnAddress: "杭州西湖店还车区",
      scheduledAt: new Date("2026-05-09T10:00:00+08:00")
    },
    create: {
      orderNo: "ORD-20260508-003",
      type: "STORE_RETURN",
      status: "PENDING",
      storeId: hangzhouStore.id,
      vehicleId: hangzhouVehicle?.id ?? null,
      licensePlateSnapshot: hangzhouVehicle?.licensePlate ?? null,
      pickupAddress: "杭州市西湖区文三路 90 号",
      returnAddress: "杭州西湖店还车区",
      scheduledAt: new Date("2026-05-09T10:00:00+08:00")
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
