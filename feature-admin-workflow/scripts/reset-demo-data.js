const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const saltRounds = 10;

const demoOrderNos = [
  "DEMO-20260629-001",
  "ORD-20260508-001",
  "ORD-20260508-002",
  "ORD-20260508-003"
];

const demoDriverPhones = ["13800000001", "13800000002", "13800000003"];
const demoVehiclePlates = ["沪A12345", "浙A67890"];
const demoStoreCodes = ["STORE_SH_HQ", "STORE_HZ_XH"];

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

async function snapshot(client) {
  const [
    stores,
    drivers,
    vehicles,
    orders,
    assignments,
    logs
  ] = await Promise.all([
    client.store.count({ where: { code: { in: demoStoreCodes } } }),
    client.driver.count({ where: { phone: { in: demoDriverPhones } } }),
    client.vehicle.count({ where: { licensePlate: { in: demoVehiclePlates } } }),
    client.order.count({ where: { orderNo: { in: demoOrderNos } } }),
    client.assignment.count({
      where: { order: { orderNo: { in: demoOrderNos } } }
    }),
    client.operationLog.count({
      where: {
        entityType: "ORDER",
        entityId: {
          in: await client.order
            .findMany({
              where: { orderNo: { in: demoOrderNos } },
              select: { id: true }
            })
            .then((items) => items.map((item) => item.id))
        }
      }
    })
  ]);

  return { stores, drivers, vehicles, orders, assignments, logs };
}

async function ensureBaseData(tx) {
  const password = await bcrypt.hash("admin123", saltRounds);

  const admin = await tx.user.upsert({
    where: { email: "admin@dispatch.dev" },
    update: {
      phone: "13800000000",
      name: "默认管理员",
      password,
      role: "admin"
    },
    create: {
      email: "admin@dispatch.dev",
      phone: "13800000000",
      name: "默认管理员",
      password,
      role: "admin"
    }
  });

  const shanghaiStore = await tx.store.upsert({
    where: { code: "STORE_SH_HQ" },
    update: { name: "上海虹桥店", isActive: true },
    create: { code: "STORE_SH_HQ", name: "上海虹桥店", isActive: true }
  });

  const hangzhouStore = await tx.store.upsert({
    where: { code: "STORE_HZ_XH" },
    update: { name: "杭州西湖店", isActive: true },
    create: { code: "STORE_HZ_XH", name: "杭州西湖店", isActive: true }
  });

  const zhangWei = await tx.driver.upsert({
    where: { phone: "13800000001" },
    update: {
      storeId: shanghaiStore.id,
      name: "张伟",
      status: "S3",
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      name: "张伟",
      phone: "13800000001",
      status: "S3",
      isActive: true
    }
  });

  const liNa = await tx.driver.upsert({
    where: { phone: "13800000002" },
    update: {
      storeId: shanghaiStore.id,
      name: "李娜",
      status: "S1",
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      name: "李娜",
      phone: "13800000002",
      status: "S1",
      isActive: true
    }
  });

  const wangQiang = await tx.driver.upsert({
    where: { phone: "13800000003" },
    update: {
      storeId: hangzhouStore.id,
      name: "王强",
      status: "S3",
      isActive: true
    },
    create: {
      storeId: hangzhouStore.id,
      name: "王强",
      phone: "13800000003",
      status: "S3",
      isActive: true
    }
  });

  const shanghaiVehicle = await tx.vehicle.upsert({
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
      status: "AVAILABLE",
      isActive: true
    }
  });

  const hangzhouVehicle = await tx.vehicle.upsert({
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
      status: "AVAILABLE",
      isActive: true
    }
  });

  return {
    admin,
    shanghaiStore,
    hangzhouStore,
    zhangWei,
    liNa,
    wangQiang,
    shanghaiVehicle,
    hangzhouVehicle
  };
}

async function clearDemoChains(tx) {
  const existingOrders = await tx.order.findMany({
    where: { orderNo: { in: demoOrderNos } },
    select: { id: true }
  });
  const orderIds = existingOrders.map((order) => order.id);

  if (!orderIds.length) {
    return;
  }

  await tx.order.updateMany({
    where: { id: { in: orderIds } },
    data: { currentAssignmentId: null, driverNameSnapshot: null }
  });

  await tx.assignment.deleteMany({
    where: { orderId: { in: orderIds } }
  });

  await tx.operationLog.deleteMany({
    where: {
      entityType: "ORDER",
      entityId: { in: orderIds }
    }
  });
}

async function upsertOrder(tx, data) {
  return tx.order.upsert({
    where: { orderNo: data.orderNo },
    update: data,
    create: data
  });
}

async function assignOrder(tx, { order, driver, admin, type = "MANUAL_ASSIGN" }) {
  const assignment = await tx.assignment.create({
    data: {
      orderId: order.id,
      driverId: driver.id,
      type,
      status: "ACTIVE",
      createdByUserId: admin.id,
      assignedAt: minutesAgo(type === "REASSIGN" ? 45 : 60)
    }
  });

  const updatedOrder = await tx.order.update({
    where: { id: order.id },
    data: {
      status: "ASSIGNED",
      currentAssignmentId: assignment.id,
      driverNameSnapshot: driver.name
    }
  });

  await tx.operationLog.create({
    data: {
      entityType: "ORDER",
      entityId: order.id,
      action: type === "REASSIGN" ? "REASSIGN" : "ASSIGN",
      operatorUserId: admin.id,
      reason: type === "REASSIGN" ? "演示数据重置：保持改派日志可检索" : null,
      createdAt: minutesAgo(type === "REASSIGN" ? 42 : 58),
      metadataJson: {
        traceId: crypto.randomUUID(),
        orderNo: order.orderNo,
        driverId: driver.id,
        driverName: driver.name,
        licensePlate: order.licensePlateSnapshot,
        assignmentId: assignment.id,
        fromStatus: "PENDING",
        toStatus: updatedOrder.status
      }
    }
  });

  return { assignment, order: updatedOrder };
}

async function createDemoLogs(tx, { admin, demoOrder, zhangWei }) {
  await tx.operationLog.createMany({
    data: [
      {
        entityType: "ORDER",
        entityId: demoOrder.id,
        action: "IMPORT",
        operatorUserId: admin.id,
        createdAt: minutesAgo(90),
        metadataJson: {
          traceId: crypto.randomUUID(),
          orderNo: demoOrder.orderNo,
          licensePlate: demoOrder.licensePlateSnapshot,
          channel: "演示数据重置",
          importBatchId: "demo-reset-20260629"
        }
      },
      {
        entityType: "ORDER",
        entityId: demoOrder.id,
        action: "WITHDRAW",
        operatorUserId: admin.id,
        reason: "演示数据重置：保留撤回查询样例",
        createdAt: minutesAgo(25),
        metadataJson: {
          traceId: crypto.randomUUID(),
          orderNo: demoOrder.orderNo,
          driverId: zhangWei.id,
          driverName: zhangWei.name,
          licensePlate: demoOrder.licensePlateSnapshot,
          stateFlow: ["ASSIGNED", "RECYCLED", "PENDING"]
        }
      }
    ]
  });
}

async function resetDemoData() {
  await prisma.$transaction(
    async (tx) => {
      const base = await ensureBaseData(tx);

      await clearDemoChains(tx);

      const demoOrder = await upsertOrder(tx, {
        orderNo: "DEMO-20260629-001",
        type: "STORE_PICKUP",
        status: "PENDING",
        storeId: base.shanghaiStore.id,
        vehicleId: base.shanghaiVehicle.id,
        licensePlateSnapshot: base.shanghaiVehicle.licensePlate,
        channel: "demo-reset",
        driverNameSnapshot: null,
        vehicleTypeSnapshot: base.shanghaiVehicle.vehicleType,
        pickupAddress: "上海虹桥门店取车区",
        pickupLat: 31.1977,
        pickupLng: 121.3275,
        returnAddress: "上海浦东新区张江路 100 号",
        returnLat: 31.2104,
        returnLng: 121.5991,
        scheduledAt: new Date("2026-06-29T10:00:00+08:00"),
        currentAssignmentId: null
      });

      await upsertOrder(tx, {
        orderNo: "ORD-20260508-001",
        type: "STORE_PICKUP",
        status: "PENDING",
        storeId: base.shanghaiStore.id,
        vehicleId: base.shanghaiVehicle.id,
        licensePlateSnapshot: base.shanghaiVehicle.licensePlate,
        channel: "demo-reset",
        driverNameSnapshot: null,
        vehicleTypeSnapshot: base.shanghaiVehicle.vehicleType,
        pickupAddress: "上海虹桥店取车区",
        pickupLat: 31.1977,
        pickupLng: 121.3275,
        returnAddress: "上海浦东新区张江路 100 号",
        returnLat: 31.2104,
        returnLng: 121.5991,
        scheduledAt: new Date("2026-05-08T09:00:00+08:00"),
        currentAssignmentId: null
      });

      const zhangOrder = await upsertOrder(tx, {
        orderNo: "ORD-20260508-002",
        type: "DOOR_DELIVERY",
        status: "PENDING",
        storeId: base.shanghaiStore.id,
        vehicleId: base.shanghaiVehicle.id,
        licensePlateSnapshot: base.shanghaiVehicle.licensePlate,
        channel: "demo-reset",
        driverNameSnapshot: null,
        vehicleTypeSnapshot: base.shanghaiVehicle.vehicleType,
        pickupAddress: "上海虹桥店停车场",
        pickupLat: 31.1977,
        pickupLng: 121.3275,
        returnAddress: "上海市闵行区申长路 888 号",
        returnLat: 31.2066,
        returnLng: 121.3201,
        scheduledAt: new Date("2026-05-08T13:30:00+08:00"),
        currentAssignmentId: null
      });

      const wangOrder = await upsertOrder(tx, {
        orderNo: "ORD-20260508-003",
        type: "STORE_RETURN",
        status: "PENDING",
        storeId: base.hangzhouStore.id,
        vehicleId: base.hangzhouVehicle.id,
        licensePlateSnapshot: base.hangzhouVehicle.licensePlate,
        channel: "demo-reset",
        driverNameSnapshot: null,
        vehicleTypeSnapshot: base.hangzhouVehicle.vehicleType,
        pickupAddress: "杭州市西湖区文三路 90 号",
        pickupLat: 30.2874,
        pickupLng: 120.1238,
        returnAddress: "杭州西湖店还车区",
        returnLat: 30.27415,
        returnLng: 120.15515,
        scheduledAt: new Date("2026-05-09T10:00:00+08:00"),
        currentAssignmentId: null
      });

      await assignOrder(tx, {
        order: zhangOrder,
        driver: base.zhangWei,
        admin: base.admin
      });

      await assignOrder(tx, {
        order: wangOrder,
        driver: base.wangQiang,
        admin: base.admin,
        type: "REASSIGN"
      });

      await createDemoLogs(tx, {
        admin: base.admin,
        demoOrder,
        zhangWei: base.zhangWei
      });
    },
    { timeout: 20000 }
  );
}

async function main() {
  const before = await snapshot(prisma);

  console.log("Demo data reset target:");
  console.table({
    stores: demoStoreCodes.join(", "),
    drivers: demoDriverPhones.join(", "),
    vehicles: demoVehiclePlates.join(", "),
    orders: demoOrderNos.join(", ")
  });
  console.log("Current snapshot:");
  console.table(before);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write demo data.");
    return;
  }

  await resetDemoData();

  const after = await snapshot(prisma);
  console.log("Demo data reset applied.");
  console.table(after);
}

main()
  .catch((error) => {
    console.error("Demo data reset failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
