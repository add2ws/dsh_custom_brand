import z from '@deepseek-ai/schemastery'

/**
 * 宿主半边。
 *
 * 它本身不渲染任何东西，只负责声明这份配置的 schema：
 * DSH 的设置服务会把它投影成一份可编辑的表单，命名空间就是 profile 里的 entry id
 * （`custom-brand`），客户端半边再通过 `ctx.configForms.get('custom-brand')` 读写它。
 *
 * 两个字段都必须是 volatile：设置服务的 `describe()` 只把 volatile 字段
 * 放进可编辑表单里（普通字段只作为只读的默认层）。
 */
export const Config = z
  .object({
    logo: z
      .string()
      .default('')
      .description(
        '品牌标识：http(s) 图片地址，或一段 emoji／文字；设置页也支持上传本地图片（≤128 KB，存为 data URI）。留空保持 DSH 原生标识。',
      )
      .volatile(),
    slogan: z
      .string()
      .default('')
      .description('品牌标语：显示在侧边栏品牌名与会话空状态页的标题处。留空保持原生文案。')
      .volatile(),
  })

/**
 * 本插件把配置写在 profile 补丁的 `config` 段里，由设置服务托管，
 * 宿主侧不需要做任何事。
 */
export function apply() {}
