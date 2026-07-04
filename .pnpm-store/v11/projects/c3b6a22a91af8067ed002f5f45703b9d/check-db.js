// check-db.js — 连通性测试，分别测 直连 和 Pooler，只读不写
const { PrismaClient } = require('@prisma/client');

const URLS = [
  { name: 'Direct Connection', url: process.env.DIRECT_DATABASE_URL },
  { name: 'Pooler (6543)',     url: process.env.DATABASE_URL },
];

async function testOne(label, url) {
  if (!url) {
    console.log(`⏭  ${label}: 未配置，跳过`);
    return false;
  }
  const masked = url.replace(/:[^:@]+@/, ':****@');
  console.log(`🔌 测试 ${label}: ${masked}`);
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
  try {
    const result = await prisma.$queryRawUnsafe(`SELECT 1 AS connected`);
    console.log(`   ✅ 连通成功: ${JSON.stringify(result)}`);
    await prisma.$disconnect();
    return true;
  } catch (err) {
    const msg = err.message.slice(0, 200);
    console.log(`   ❌ 失败: ${msg}`);
    try { await prisma.$disconnect(); } catch (_) {}
    return false;
  }
}

async function main() {
  console.log('🟢 云数据库连通性检查\n');

  const directOk = await testOne(URLS[0].name, URLS[0].url);
  console.log('');
  const poolerOk = await testOne(URLS[1].name, URLS[1].url);

  console.log('\n' + '━'.repeat(40));
  console.log(`Direct: ${directOk ? '✅' : '❌'}  |  Pooler: ${poolerOk ? '✅' : '❌'}`);
  console.log('━'.repeat(40));

  if (directOk || poolerOk) {
    // 用通的那条查一下库里有什么
    const okUrl = directOk ? URLS[0].url : URLS[1].url;
    const prisma = new PrismaClient({ datasources: { db: { url: okUrl } }, log: [] });
    try {
      const tables = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
      if (tables.length === 0) {
        console.log('\n📭 空库，无表');
      } else {
        console.log('\n📋 已有表: ' + tables.map(t => t.tablename).join(', '));
      }
      const migrationRows = await prisma.$queryRawUnsafe(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3`);
      if (migrationRows.length > 0) {
        console.log('📋 最近迁移:');
        migrationRows.forEach(r => console.log(`   └ ${r.migration_name}`));
      }
      await prisma.$disconnect();
    } catch (e) {
      console.log('\n📭 无 _prisma_migrations 表，或查表失败: ' + e.message.slice(0, 150));
      try { await prisma.$disconnect(); } catch (_) {}
    }
  }
}

main();
