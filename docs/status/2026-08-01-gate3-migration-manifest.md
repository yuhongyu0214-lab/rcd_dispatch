# Gate 3 最终 migration 清单与 checksum

> 状态：`REUSED_AFTER_BYTE_IDENTICAL_REVERIFY`
> 最终更新时间：2026-08-03（Asia/Shanghai）
> 唯一应用候选：`codex/v2-gate3-app-candidate @ 492c86ea51b40da9426b8ad5b6aef861aa429ab5`
> 正向 migration 数：9
> SQL 文件总数：17（9 个正向 + 8 个 rollback）

## 1. 计算口径

- 每个 SHA-256 直接对候选提交中的 Git blob 原始字节计算，不读取主工作区，也不对换行或编码做转换。
- 路径按字典序排列；正向清单使用 UTF-8、LF，每行格式为 `<sha256><两个空格><仓库相对路径>`，文件末尾保留一个 LF。
- 正向清单文件：[2026-08-01-gate3-migrations.sha256](2026-08-01-gate3-migrations.sha256)。
- 正向清单自身 SHA-256：`a5f70be102f46a026e7d482155364bb2a513ce6714b2871148a0e9031261d47d`。
- 全部 17 个 SQL 条目按同一格式聚合后的 SHA-256：`b35b7322cd6961249c006dca0d4e18e3a84dc52af8a5bd72a99d5e0b5b89ef5f`。
- 本清单最初从 `3dea9260865f7e6ed42938d83e370e3823d31a2d` 生成并完成空库演练；随后核对 `169f2ad8b27f9f0be2d4630144315694656b6a67`、`7378303f513d92e781a7930cfff7e14269ec3126` 与当前候选后，Schema 与 migration 目录均无差异，migration tree id 均为 `c9b46aa4782b8b909e1bcc238e7514bf538270f1`，因此原始字节指纹和演练结论继续有效。

## 2. 九个 migration

| 顺序 | migration                                         | 正向 SHA-256                                                       | rollback SHA-256                                                   | 结论                                           |
| ---: | ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------- |
|    1 | `20260424155535_init_user`                        | `3820c5afc1f19ee3e5a68732eb2f45705c6eb561a8bec29fd339972810a8a1b8` | 缺失                                                               | 空库演练前必须保留失败现场；不得声称可自动回退 |
|    2 | `20260502120000_data_model_core`                  | `f8595f228b75ed05142b9965d5e3266693027d63910d418b90de81c6eeeb0b89` | `581906f6f7755ab3e207b926cd954d3601b268387778b9a5f3a660c9b4845d79` | 有 rollback                                    |
|    3 | `20260508120000_data_model_v1_gap_fix`            | `402b235a2016b0d09c628af67072a396502f9898d4b06557b10c2e94239cd70c` | `7c3bc7c581cb46152254aaee3e1b712973b54ee738ddc99288e0aa5f8b2f12c0` | 有 rollback                                    |
|    4 | `20260508183000_order_import_v1`                  | `1cea1bce5d3df2bcc41879f4c476d219457c7dc3394b64ecfcad0c6aae34311f` | `7d536461151cba58737eb669fdf38273b5640f42e37114be67557d2f1cb62c71` | 有 rollback                                    |
|    5 | `20260704_production_v1`                          | `c362fbcb320ea22e6362d687e29afabe65e4e298c9bd01dc60a4567608443568` | `98d75d152675f7c611b18ebd01b6a11b4c1301d2b775a7158d2b13e7420928b4` | 有 rollback                                    |
|    6 | `20260717180000_v2_data_model`                    | `31e441f09c7835cd377dfdbf7a98e7559c72d0b92b245dd0d282acf7bd29ccae` | `c1c20e6285f04a149da7e92bad507e212772c423ab3d84bc2ea787028cc57c8e` | 有数据安全护栏                                 |
|    7 | `20260719192834_add_internal_source_system`       | `f5b2a84f444c14792347dff693147ffbe49abb4876e1ac10da588a52e19c3896` | `16a5ccde6e2c12e3b4521db29a71b9d717ada7ae566d20eb0f2e889f816dc42b` | 有数据安全护栏                                 |
|    8 | `20260719213100_add_internal_source_system_check` | `b1e48dab19cb9339bf4da5d1e81e422f0aa0cc3eaadaf46c1f94fa75405a071b` | `2c570e177cd9b866257c6cf70f34a34cdeaf7aa5d6fc534b081c189de09b60a3` | 有 rollback                                    |
|    9 | `20260726143000_dispatch_event_outbox`            | `74d9a8780bc06a1bf4e95ef42cbabea3f91719d5b861845ada540b573b9d8410` | `6e343425c1c02f63bbc66e976189fd7ca4c61ded9a611d5b1e4b661059b2e765` | 非空 outbox 时 rollback 主动阻断               |

## 3. 全部 SQL 原始字节指纹

```text
3820c5afc1f19ee3e5a68732eb2f45705c6eb561a8bec29fd339972810a8a1b8  feature-admin-workflow/prisma/migrations/20260424155535_init_user/migration.sql
f8595f228b75ed05142b9965d5e3266693027d63910d418b90de81c6eeeb0b89  feature-admin-workflow/prisma/migrations/20260502120000_data_model_core/migration.sql
581906f6f7755ab3e207b926cd954d3601b268387778b9a5f3a660c9b4845d79  feature-admin-workflow/prisma/migrations/20260502120000_data_model_core/rollback.sql
402b235a2016b0d09c628af67072a396502f9898d4b06557b10c2e94239cd70c  feature-admin-workflow/prisma/migrations/20260508120000_data_model_v1_gap_fix/migration.sql
7c3bc7c581cb46152254aaee3e1b712973b54ee738ddc99288e0aa5f8b2f12c0  feature-admin-workflow/prisma/migrations/20260508120000_data_model_v1_gap_fix/rollback.sql
1cea1bce5d3df2bcc41879f4c476d219457c7dc3394b64ecfcad0c6aae34311f  feature-admin-workflow/prisma/migrations/20260508183000_order_import_v1/migration.sql
7d536461151cba58737eb669fdf38273b5640f42e37114be67557d2f1cb62c71  feature-admin-workflow/prisma/migrations/20260508183000_order_import_v1/rollback.sql
c362fbcb320ea22e6362d687e29afabe65e4e298c9bd01dc60a4567608443568  feature-admin-workflow/prisma/migrations/20260704_production_v1/migration.sql
98d75d152675f7c611b18ebd01b6a11b4c1301d2b775a7158d2b13e7420928b4  feature-admin-workflow/prisma/migrations/20260704_production_v1/rollback.sql
31e441f09c7835cd377dfdbf7a98e7559c72d0b92b245dd0d282acf7bd29ccae  feature-admin-workflow/prisma/migrations/20260717180000_v2_data_model/migration.sql
c1c20e6285f04a149da7e92bad507e212772c423ab3d84bc2ea787028cc57c8e  feature-admin-workflow/prisma/migrations/20260717180000_v2_data_model/rollback.sql
f5b2a84f444c14792347dff693147ffbe49abb4876e1ac10da588a52e19c3896  feature-admin-workflow/prisma/migrations/20260719192834_add_internal_source_system/migration.sql
16a5ccde6e2c12e3b4521db29a71b9d717ada7ae566d20eb0f2e889f816dc42b  feature-admin-workflow/prisma/migrations/20260719192834_add_internal_source_system/rollback.sql
b1e48dab19cb9339bf4da5d1e81e422f0aa0cc3eaadaf46c1f94fa75405a071b  feature-admin-workflow/prisma/migrations/20260719213100_add_internal_source_system_check/migration.sql
2c570e177cd9b866257c6cf70f34a34cdeaf7aa5d6fc534b081c189de09b60a3  feature-admin-workflow/prisma/migrations/20260719213100_add_internal_source_system_check/rollback.sql
74d9a8780bc06a1bf4e95ef42cbabea3f91719d5b861845ada540b573b9d8410  feature-admin-workflow/prisma/migrations/20260726143000_dispatch_event_outbox/migration.sql
6e343425c1c02f63bbc66e976189fd7ca4c61ded9a611d5b1e4b661059b2e765  feature-admin-workflow/prisma/migrations/20260726143000_dispatch_event_outbox/rollback.sql
```

## 4. 当前结论

清单和 checksum 已从旧冻结候选的原始 Git 对象生成并完成演练；新候选的 Schema 和 migration tree 经 Git 对象比较完全相同，因此无需因部署返修重复数据库演练。该结论仍不代表 Gate 3 已 PASS，阿里云预生产 migration 与最终 Gate 3 终审尚未完成。

`20260424155535_init_user` 仍没有 rollback；发生不可恢复失败时必须保留现场并整体重建一次性库，不能声称九步全链可自动回退。

大白话：9 张施工图和 8 张撤销图纸都已按最终版本验过，安全门也会在有重要数据时拒绝拆除；第一张仍没有撤销图，所以极端失败时要封存现场并整库重建。
