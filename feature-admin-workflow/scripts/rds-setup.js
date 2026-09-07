// RDS 初始化脚本 — 数据库连接串从环境变量读取，禁止硬编码凭证
// 使用方式: DATABASE_URL="postgresql://..." node scripts/rds-setup.js

const { PrismaClient } = require("@prisma/client");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ 缺少 DATABASE_URL 环境变量，请设置后重试");
  console.error("   示例: DATABASE_URL='postgresql://user:pass@host:5432/db' node scripts/rds-setup.js");
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

async function main() {
  console.log("连接 RDS...");

  // 1. 授权 dispatch_admin
  console.log("1/4 授权 dispatch_admin...");
  await prisma.$executeRawUnsafe("GRANT ALL ON SCHEMA public TO dispatch_admin");
  console.log("  ✅ GRANT 成功");

  // 2. 建索引
  console.log("2/4 建索引 idx_order_geocode_pickup_status...");
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_order_geocode_pickup_status
    ON public."Order" ("geocodePickupStatus")
    WHERE "geocodePickupStatus" IS NOT NULL
  `);
  console.log("  ✅ 成功");

  console.log("3/4 建索引 idx_order_geocode_return_status...");
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_order_geocode_return_status
    ON public."Order" ("geocodeReturnStatus")
    WHERE "geocodeReturnStatus" IS NOT NULL
  `);
  console.log("  ✅ 成功");

  console.log("4/4 建索引 idx_order_channel...");
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_order_channel
    ON public."Order" ("channel")
    WHERE "channel" IS NOT NULL
  `);
  console.log("  ✅ 成功");

  // 验证
  const indexes = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'Order'
    ORDER BY indexname
  `);
  console.log("\n当前 Order 表索引:", indexes.map(r => r.indexname).join(", "));
  console.log("\n✅ RDS 初始化完成");
}

main()
  .catch((e) => {
    console.error("❌ 失败:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
