const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function main() {
  const adminPasswordHash = await bcrypt.hash("admin123", SALT_ROUNDS);
  const seedNow = new Date();
  const minutesFromSeed = (minutes) => new Date(seedNow.getTime() + minutes * 60_000);
  const zhangLocationAt = seedNow;
  const liLocationAt = new Date(seedNow.getTime() - 30_000);
  const shiftStartedAt = minutesFromSeed(-30);
  const orderReceivedAt = minutesFromSeed(-20);
  const orderAPickupAt = minutesFromSeed(24 * 60);
  const orderBPickupAt = minutesFromSeed(26 * 60);
  const orderCPickupAt = minutesFromSeed(25 * 60);

  const admin = await prisma.user.upsert({
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

  const zhangWei = await prisma.driver.upsert({
    where: { phone: "13800000001" },
    update: {
      storeId: shanghaiStore.id,
      name: "张伟",
      status: "S1",
      onShift: true,
      availability: "AVAILABLE",
      lastLat: 31.1977,
      lastLng: 121.3275,
      lastAccuracyMeters: 18,
      lastLocationCapturedAt: zhangLocationAt,
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      name: "张伟",
      phone: "13800000001",
      status: "S1",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 1,
      lastLat: 31.1977,
      lastLng: 121.3275,
      lastAccuracyMeters: 18,
      lastLocationCapturedAt: zhangLocationAt
    }
  });

  const liNa = await prisma.driver.upsert({
    where: { phone: "13800000002" },
    update: {
      storeId: shanghaiStore.id,
      name: "李娜",
      status: "S2",
      onShift: true,
      availability: "AVAILABLE",
      lastLat: 31.205,
      lastLng: 121.335,
      lastAccuracyMeters: 22,
      lastLocationCapturedAt: liLocationAt,
      isActive: true
    },
    create: {
      storeId: shanghaiStore.id,
      name: "李娜",
      phone: "13800000002",
      status: "S2",
      onShift: true,
      availability: "AVAILABLE",
      planVersion: 1,
      lastLat: 31.205,
      lastLng: 121.335,
      lastAccuracyMeters: 22,
      lastLocationCapturedAt: liLocationAt
    }
  });

  const wangQiang = await prisma.driver.upsert({
    where: { phone: "13800000003" },
    update: {
      storeId: hangzhouStore.id,
      name: "王强",
      status: "OFFLINE",
      onShift: false,
      availability: "AVAILABLE",
      isActive: true
    },
    create: {
      storeId: hangzhouStore.id,
      name: "王强",
      phone: "13800000003",
      status: "OFFLINE",
      onShift: false,
      availability: "AVAILABLE",
      planVersion: 1
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

  const orderA = await prisma.order.upsert({
    where: {
      sourceSystem_externalOrderId: {
        sourceSystem: "API",
        externalOrderId: "seed-api-order-001"
      }
    },
    update: {
      type: "STORE_PICKUP",
      status: "ASSIGNED",
      sourceSystem: "API",
      externalOrderId: "seed-api-order-001",
      sourceVersion: "00000000000000000001",
      executionStatus: "PLANNED",
      feasibility: "NORMAL",
      slackMinutes: 25,
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店取车区",
      returnAddress: "上海浦东新区张江路 100 号",
      deliveryAddress: "上海浦东新区张江路 100 号",
      scheduledAt: orderAPickupAt,
      promisedPickupAt: orderAPickupAt,
      receivedAt: orderReceivedAt
    },
    create: {
      orderNo: "RC-20260508-001",
      type: "STORE_PICKUP",
      status: "ASSIGNED",
      sourceSystem: "API",
      externalOrderId: "seed-api-order-001",
      sourceVersion: "00000000000000000001",
      executionStatus: "PLANNED",
      feasibility: "NORMAL",
      slackMinutes: 25,
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店取车区",
      returnAddress: "上海浦东新区张江路 100 号",
      deliveryAddress: "上海浦东新区张江路 100 号",
      scheduledAt: orderAPickupAt,
      promisedPickupAt: orderAPickupAt,
      receivedAt: orderReceivedAt
    }
  });

  const orderB = await prisma.order.upsert({
    where: {
      sourceSystem_externalOrderId: {
        sourceSystem: "API",
        externalOrderId: "seed-api-order-002"
      }
    },
    update: {
      type: "DOOR_DELIVERY",
      status: "ASSIGNED",
      sourceSystem: "API",
      externalOrderId: "seed-api-order-002",
      sourceVersion: "00000000000000000001",
      executionStatus: "PLANNED",
      feasibility: "AT_RISK",
      slackMinutes: 5,
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店停车场",
      returnAddress: "上海市闵行区申长路 888 号",
      deliveryAddress: "上海市闵行区申长路 888 号",
      scheduledAt: orderBPickupAt,
      promisedPickupAt: orderBPickupAt,
      receivedAt: orderReceivedAt
    },
    create: {
      orderNo: "RC-20260508-002",
      type: "DOOR_DELIVERY",
      status: "ASSIGNED",
      sourceSystem: "API",
      externalOrderId: "seed-api-order-002",
      sourceVersion: "00000000000000000001",
      executionStatus: "PLANNED",
      feasibility: "AT_RISK",
      slackMinutes: 5,
      storeId: shanghaiStore.id,
      vehicleId: shanghaiVehicle?.id ?? null,
      licensePlateSnapshot: shanghaiVehicle?.licensePlate ?? null,
      pickupAddress: "上海虹桥店停车场",
      returnAddress: "上海市闵行区申长路 888 号",
      deliveryAddress: "上海市闵行区申长路 888 号",
      scheduledAt: orderBPickupAt,
      promisedPickupAt: orderBPickupAt,
      receivedAt: orderReceivedAt
    }
  });

  const orderC = await prisma.order.upsert({
    where: {
      sourceSystem_externalOrderId: {
        sourceSystem: "API",
        externalOrderId: "seed-api-order-003"
      }
    },
    update: {
      type: "STORE_RETURN",
      status: "PENDING",
      sourceSystem: "API",
      externalOrderId: "seed-api-order-003",
      sourceVersion: "00000000000000000001",
      executionStatus: "UNASSIGNED",
      feasibility: "INFEASIBLE",
      slackMinutes: -45,
      storeId: hangzhouStore.id,
      vehicleId: hangzhouVehicle?.id ?? null,
      licensePlateSnapshot: hangzhouVehicle?.licensePlate ?? null,
      pickupAddress: "杭州市西湖区文三路 90 号",
      returnAddress: "杭州西湖店还车区",
      deliveryAddress: "杭州西湖店还车区",
      scheduledAt: orderCPickupAt,
      promisedPickupAt: orderCPickupAt,
      receivedAt: orderReceivedAt
    },
    create: {
      orderNo: "RC-20260508-003",
      type: "STORE_RETURN",
      status: "PENDING",
      sourceSystem: "API",
      externalOrderId: "seed-api-order-003",
      sourceVersion: "00000000000000000001",
      executionStatus: "UNASSIGNED",
      feasibility: "INFEASIBLE",
      slackMinutes: -45,
      storeId: hangzhouStore.id,
      vehicleId: hangzhouVehicle?.id ?? null,
      licensePlateSnapshot: hangzhouVehicle?.licensePlate ?? null,
      pickupAddress: "杭州市西湖区文三路 90 号",
      returnAddress: "杭州西湖店还车区",
      deliveryAddress: "杭州西湖店还车区",
      scheduledAt: orderCPickupAt,
      promisedPickupAt: orderCPickupAt,
      receivedAt: orderReceivedAt
    }
  });

  const assignmentA = await prisma.assignment.upsert({
    where: { id: "seed-v2-assignment-a" },
    update: {
      orderId: orderA.id,
      driverId: zhangWei.id,
      type: "MANUAL_ASSIGN",
      status: "ACTIVE",
      createdByUserId: admin.id,
      sequenceNo: 1,
      plannedDepartAt: minutesFromSeed(24 * 60 - 40),
      plannedPickupAt: minutesFromSeed(24 * 60 - 25),
      plannedCompleteAt: minutesFromSeed(25 * 60),
      deadheadEtaMinutes: 15,
      serviceEtaMinutes: 55,
      lockType: "MANUAL_LOCKED",
      lastEtaCalculatedAt: seedNow
    },
    create: {
      id: "seed-v2-assignment-a",
      orderId: orderA.id,
      driverId: zhangWei.id,
      type: "MANUAL_ASSIGN",
      status: "ACTIVE",
      createdByUserId: admin.id,
      sequenceNo: 1,
      plannedDepartAt: minutesFromSeed(24 * 60 - 40),
      plannedPickupAt: minutesFromSeed(24 * 60 - 25),
      plannedCompleteAt: minutesFromSeed(25 * 60),
      deadheadEtaMinutes: 15,
      serviceEtaMinutes: 55,
      lockType: "MANUAL_LOCKED",
      lastEtaCalculatedAt: seedNow
    }
  });

  const assignmentB = await prisma.assignment.upsert({
    where: { id: "seed-v2-assignment-b" },
    update: {
      orderId: orderB.id,
      driverId: zhangWei.id,
      type: "RECOMMEND_ASSIGN",
      status: "ACTIVE",
      createdByUserId: admin.id,
      sequenceNo: 2,
      plannedDepartAt: minutesFromSeed(25 * 60),
      plannedPickupAt: minutesFromSeed(26 * 60 - 5),
      plannedCompleteAt: minutesFromSeed(27 * 60 + 5),
      deadheadEtaMinutes: 55,
      serviceEtaMinutes: 60,
      lockType: "NONE",
      lastEtaCalculatedAt: seedNow
    },
    create: {
      id: "seed-v2-assignment-b",
      orderId: orderB.id,
      driverId: zhangWei.id,
      type: "RECOMMEND_ASSIGN",
      status: "ACTIVE",
      createdByUserId: admin.id,
      sequenceNo: 2,
      plannedDepartAt: minutesFromSeed(25 * 60),
      plannedPickupAt: minutesFromSeed(26 * 60 - 5),
      plannedCompleteAt: minutesFromSeed(27 * 60 + 5),
      deadheadEtaMinutes: 55,
      serviceEtaMinutes: 60,
      lockType: "NONE",
      lastEtaCalculatedAt: seedNow
    }
  });

  await prisma.order.update({
    where: { id: orderA.id },
    data: { currentAssignmentId: assignmentA.id }
  });
  await prisma.order.update({
    where: { id: orderB.id },
    data: { currentAssignmentId: assignmentB.id }
  });

  await prisma.orderServicePlan.upsert({
    where: { assignmentId: assignmentA.id },
    update: {
      modulesJson: ["WASHING", "HANDOVER_FORMALITIES"],
      totalModuleMinutes: 20,
      revision: 1,
      updatedByUserId: admin.id
    },
    create: {
      assignmentId: assignmentA.id,
      modulesJson: ["WASHING", "HANDOVER_FORMALITIES"],
      totalModuleMinutes: 20,
      revision: 1,
      updatedByUserId: admin.id
    }
  });

  await prisma.orderServicePlan.upsert({
    where: { assignmentId: assignmentB.id },
    update: {
      modulesJson: ["REFUELING"],
      totalModuleMinutes: 5,
      revision: 1,
      updatedByUserId: admin.id
    },
    create: {
      assignmentId: assignmentB.id,
      modulesJson: ["REFUELING"],
      totalModuleMinutes: 5,
      revision: 1,
      updatedByUserId: admin.id
    }
  });

  await prisma.dispatchAlert.upsert({
    where: { id: "seed-v2-infeasible-alert" },
    update: {
      orderId: orderC.id,
      type: "INFEASIBLE",
      status: "OPEN",
      slackMinutesAtCreate: -45,
      resolvedAt: null,
      resolvedBy: null
    },
    create: {
      id: "seed-v2-infeasible-alert",
      orderId: orderC.id,
      type: "INFEASIBLE",
      status: "OPEN",
      slackMinutesAtCreate: -45
    }
  });

  for (const driver of [zhangWei, liNa]) {
    await prisma.driverShift.upsert({
      where: { id: `seed-v2-shift-${driver.id}` },
      update: {
        driverId: driver.id,
        startedAt: shiftStartedAt,
        endedAt: null
      },
      create: {
        id: `seed-v2-shift-${driver.id}`,
        driverId: driver.id,
        startedAt: shiftStartedAt
      }
    });
  }

  const locationSamples = [
    { id: "seed-v2-location-zhang", driver: zhangWei, lat: 31.1977, lng: 121.3275, accuracyMeters: 18, capturedAt: zhangLocationAt },
    { id: "seed-v2-location-lina", driver: liNa, lat: 31.205, lng: 121.335, accuracyMeters: 22, capturedAt: liLocationAt }
  ];

  for (const sample of locationSamples) {
    await prisma.driverLocationSample.upsert({
      where: {
        id: sample.id
      },
      update: {
        lat: sample.lat,
        lng: sample.lng,
        accuracyMeters: sample.accuracyMeters
      },
      create: {
        id: sample.id,
        driverId: sample.driver.id,
        lat: sample.lat,
        lng: sample.lng,
        accuracyMeters: sample.accuracyMeters,
        capturedAt: sample.capturedAt
      }
    });
  }

  for (const order of [orderA, orderB, orderC]) {
    const sourceStatusRaw = order.id === orderC.id ? "SOURCE_NEW" : "SOURCE_CONFIRMED";
    await prisma.orderSourceEvent.upsert({
      where: {
        sourceSystem_externalOrderId_sourceVersion: {
          sourceSystem: order.sourceSystem,
          externalOrderId: order.externalOrderId,
          sourceVersion: order.sourceVersion
        }
      },
      update: {
        orderId: order.id,
        sourceStatusRaw,
        result: "SUCCESS",
        reason: null,
        payloadSummary: { seedScenario: true },
        processedAt: seedNow
      },
      create: {
        orderId: order.id,
        sourceSystem: order.sourceSystem,
        externalOrderId: order.externalOrderId,
        sourceVersion: order.sourceVersion,
        sourceStatusRaw,
        result: "SUCCESS",
        payloadSummary: { seedScenario: true },
        receivedAt: order.receivedAt,
        processedAt: seedNow
      }
    });
  }

  void wangQiang;
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
