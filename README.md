# dsh-plugin-custom-brand

自定义 DSH 的**品牌标识（logo）**与**品牌标语（slogan）**。

安装后，**设置 → 品牌** 里可以配置，保存即生效：

| 位置 | 槽位 | 说明 |
| --- | --- | --- |
| 侧边栏品牌行 / 折叠轨道 | `sidebar.brand.mark` | 自定义 logo |
| 侧边栏品牌名 | `sidebar.brand.name` | 自定义标语 |
| 会话空状态页标题前 | `conversation.hero.brand.mark` | 自定义 logo + 标语 |

**品牌标识（Logo）有三种填法**：

1. **上传本地图片** —— 点「上传图片」选文件，前端读成 `data:image/…` 存进配置。
   只接受图片类型，原图上限 128 KB（data URI 会写进设置文档，不能放任它膨胀）。
2. **点选 emoji** —— 设置页列出 50 个候选，点一下即填入。候选刻意只用单码位
   emoji，免得不同字体下行高、宽度不一致把品牌行的几何搞乱。
3. **手填文本** —— `http(s)` 图片地址，或任意 emoji／短文字（≤2000 字符）。

两项都留空时，插件完全不占用槽位，DSH 保持原生品牌。

## 配置项

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `logo` | string | `http(s)` 图片地址、`data:image/…`（上传产物），或一段 emoji／文字。留空保持原生标识。 |
| `slogan` | string | 最多 60 字符，显示在侧边栏品牌名与会话空状态页标题处。留空保持原生文案。 |

配置由 DSH 设置服务托管（命名空间 = profile 里的 entry id `custom-brand`），
持久化在 profile 补丁文档里，也可以在 `cordis.patch.yml` 里直接写：

```yaml
- id: custom-brand
  name: '@local/dsh-plugin-brand'
  config:
    logo: '🐳'
    slogan: '探索未至之境'
```

## 安装

本插件是一个 DSH bundle，用自带的插件管理器安装即可（DSH 里：设置 → 插件 → 安装，
或直接调用 `plugin_manager` / `dsh` 的插件安装流程），安装源指向本目录：

```
file:D:/Work/dsh_space/plugin_dev/dsh-plugin-custom-brand
```

也可以手动安装：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

手动安装会做两件事：把包复制进 `$env:DSH_PROFILE_DIR\node_modules\@local\`，
并在 profile 的 `cordis.patch.yml` 里登记 `- id: custom-brand`。

> **必须用复制而不是软链接**：宿主半边 `host.js` 会 `import z from '@deepseek-ai/schemastery'`，
> Node 解析包时用的是符号链接的**真实路径**，软链接进来的插件会从源码目录向上找
> `node_modules`，从而找不到 schemastery。插件管理器安装的就是真实目录，所以推荐它。

### 安装后可能需要重装一次

DSH 的宿主进程按**包名**缓存已导入的插件模块。如果这个包名在本次进程启动后
曾被导入过（例如安装过程中失败过一次），该缓存不会自动失效，表现为
`plugin_manager list_plugins` 显示 fiber 已经是 `active`，但
`cordis_inspect_query`（Config / `listConfigs`）里这个 entry 的状态是 `absent`
（`fiber.runtime.Config` 为空），插件实际上什么都没做。

**换个新包名重装即可**（本插件就因此从 `@local/dsh-plugin-custom-brand`
改名为 `@local/dsh-plugin-brand`）；实在不行重启 DSH，entry 状态会变成 `schema`。

## 实现说明

* 宿主半边（`host.js`）只声明 `Config` schema（两个字段都必须是 `.volatile()`，
  设置服务的 `describe()` 只把 volatile 字段放进可编辑表单）。
* 客户端半边（`client.js`）：
  * `ctx.configForms.get('custom-brand')` 读写同一份配置；
  * 订阅配置，按需注册三个品牌槽位的 occupant。槽位是 `single` 类型，
    后注册者用 `priority: -1` 覆盖原生品牌（数值越小越先渲染），
    配置清空后撤销占用，让原生品牌回来；
  * 空状态页的标题文案 `hero.headline` 既没有槽位、也不能被重新注册
    （locale 服务对同一命名空间的同一语言会直接抛错），所以标语渲染在自己的
    occupant 里，并用一条自限定作用域的 `:has()` 规则隐藏紧随其后的原生标题组：
    选择器只认「直接子 `span` 里带着 `data-dsh-brand-slogan` 的那个 `div`」，
    不会误伤同样装着标题与输入框的父容器。
* 写进 `<img src>` 之前只放行 `data:image/` 与 `http(s)://`，其余一律当作文本渲染；
  文本按上限截断（logo 2000 字符、标语 60 字符）。

## 测试

```bash
node test/client.test.mjs
```

在 Node 里以 `window.__ModuleLoader__` 桩加载客户端半边，断言模块 id、导出形态，
以及配置归一化与 URL 白名单这两个纯函数的行为。
