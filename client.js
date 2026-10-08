/**
 * 客户端半边：把 DSH 的「品牌标识」与「品牌标语」换成用户配置的内容。
 *
 * 覆盖面（都是 DSH 已经声明的品牌槽位）：
 *   - `sidebar.brand.mark`          侧边栏展开态品牌行 / 折叠态轨道上的标识
 *   - `sidebar.brand.name`          侧边栏品牌行里的品牌名（这里承载标语）
 *   - `conversation.hero.brand.mark` 会话空状态页标题前的标识
 *
 * 两个关键取舍：
 *
 *   1. 只按需占用。槽位是 `single` 类型：一旦注册，原生 occupant（官方品牌包
 *      的鱼形 mark / wordmark）与 owner 的 fallback 都会被顶掉。所以这里订阅配置，
 *      只有真正配置了 logo / 标语才注册，未配置时插件等于不存在。
 *
 *   2. 标语借位显示。空状态页的标题文案 `hero.headline` 由 conversation 包渲染，
 *      既没有对应槽位，也不能被重新注册（locale 服务对同一命名空间的同一语言
 *      会直接抛错），所以标语渲染在自己的 occupant 里，并用一条 `:has()` 规则
 *      把紧随其后的原生标题组隐藏掉——选择器只认「直接子 span 里带着
 *      `data-dsh-brand-slogan` 的那个 div」，不会误伤其他容器（比如同时装着
 *      标题与输入框的 stack）。
 *
 * 配置通过宿主半边声明的 Config schema 持久化在 profile 里，命名空间 = entry id。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-brand',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 宿主半边在 profile 里的 entry id，同时也是设置文档的命名空间。 */
    const ENTRY_ID = 'custom-brand'
    /** 设置页在 locale 服务里的命名空间。 */
    const NS = 'custom-brand'

    /** 文本形态 logo（URL / emoji / 文字）的长度上限：过长会撑坏侧边栏与英雄区布局。 */
    const LOGO_TEXT_MAX = 2000
    /** 上传图片转成 data URI 后的长度上限；超限直接丢弃（截断只会得到坏图）。 */
    const LOGO_DATA_MAX = 400_000
    /** 上传原图的大小上限；data URI 会进设置文档，不能放任它无限膨胀。 */
    const UPLOAD_MAX_BYTES = 128 * 1024
    const SLOGAN_MAX = 60

    /** 只有这两种前缀才允许交给 `<img src>`，其余一律当作文本渲染。 */
    const IMAGE_SOURCE = /^(?:data:image\/|https?:\/\/)/i

    /**
     * 供用户直接点选的品牌标识候选。
     * 刻意只用单码位 emoji（不带变体选择符与 ZWJ 组合），
     * 免得不同字体下行高、宽度不一致，把品牌行的几何搞乱。
     */
    const EMOJI_CHOICES = [
      '🐳', '🐋', '🐬', '🐟', '🐠', '🦈', '🐙', '🦑', '🦀', '🐢',
      '🦊', '🐱', '🐶', '🐼', '🐨', '🦁', '🐯', '🐻', '🐰', '🦄',
      '🐸', '🐵', '🦉', '🦅', '🐝', '🦋', '🐞', '🐌', '🦖', '🐉',
      '🚀', '🛸', '⚓', '🧭', '💡', '🔥', '⚡', '⭐', '🌙', '🌈',
      '🍁', '🌊', '🍀', '🌸', '🎯', '🧩', '🎨', '🔮', '💎', '🪐',
    ]

    /** 隐藏原生英雄标题的样式标签 id，用于去重注入。 */
    const HERO_CSS_ID = '@local/dsh-plugin-brand/hero-slogan.css'
    const HERO_CSS =
      'div:has(> span > [data-dsh-brand-slogan]) > span:not(:has([data-dsh-brand-slogan])){display:none!important}'

    /**
     * 归一化一段配置文本：非字符串退化为空串，去首尾空白，并截断到上限。
     * @param value - 来自设置文档的原始值。
     * @param max - 允许的最大长度。
     * @returns 可直接渲染的文本。
     */
    function normalize(value, max) {
      if (typeof value !== 'string') return ''
      const trimmed = value.trim()
      return trimmed.length > max ? trimmed.slice(0, max) : trimmed
    }

    /**
     * 归一化品牌标识。
     * data URI 只做长度护栏，而且是「超限整体丢弃」——截断 data URI 只会得到一张坏图；
     * 其余按普通文本去首尾空白并截断。
     * @param value - 来自设置文档或输入框的原始值。
     * @returns 可直接渲染的标识内容。
     */
    function normalizeLogo(value) {
      if (typeof value !== 'string') return ''
      if (value.startsWith('data:')) return value.length > LOGO_DATA_MAX ? '' : value
      return normalize(value, LOGO_TEXT_MAX)
    }

    /**
     * 判断一段配置是否是可以直接作为图片地址使用的 URL。
     * 这是信任边界检查：写进 `<img src>` 之前必须过滤协议。
     * @param value - 已归一化的配置值。
     * @returns 是否按图片渲染。
     */
    function isImageSource(value) {
      return IMAGE_SOURCE.test(value)
    }

    /**
     * 把字节数格式化成便于阅读的文本，用于上传后的说明。
     * @param bytes - 字节数。
     * @returns 形如 `12.3 KB` 的文本。
     */
    function formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`
      return `${(bytes / 1024).toFixed(1)} KB`
    }

    /**
     * 把用户选中的图片读成 data URI，交给调用方写入草稿。
     * 类型与体积都按信任边界处理：文件是用户输入，不校验就会直接进设置文档。
     * @param file - 文件选择框给出的文件。
     * @param accept - 接受时回调，参数为 data URI。
     * @param reject - 拒绝时回调，参数为文案 key。
     */
    function readImageFile(file, accept, reject) {
      if (!file.type.startsWith('image/')) {
        reject('logoNotImage')
        return
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        reject('logoTooLarge')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') accept(reader.result)
        else reject('logoReadFailed')
      }
      reader.onerror = () => reject('logoReadFailed')
      reader.readAsDataURL(file)
    }

    /**
     * 品牌标识：图片或一段文字（emoji 也走这条路）。
     * @param props - `value` 已归一化的标识内容；`size` 宿主给出的方形边长。
     * @returns 标识元素。
     */
    function Logo({ value, size }) {
      if (isImageSource(value)) {
        return h('img', {
          src: value,
          alt: '',
          width: size,
          height: size,
          style: {
            display: 'block',
            objectFit: 'contain',
            borderRadius: 4,
            flex: 'none',
          },
        })
      }
      return h(
        'span',
        {
          'aria-hidden': 'true',
          style: {
            display: 'block',
            fontSize: Math.round(size * 0.83),
            lineHeight: `${size}px`,
            textAlign: 'center',
            flex: 'none',
          },
        },
        value,
      )
    }

    /**
     * 品牌标语文本。
     * @param props - `value` 已归一化的标语。
     * @returns 标语元素。
     */
    function Slogan({ value }) {
      return h(
        'span',
        {
          title: value,
          style: {
            display: 'block',
            minWidth: 0,
            maxWidth: '60vw',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        value,
      )
    }

    /**
     * 读取配置表单快照的 React 钩子。
     * `getSnapshot` 返回的是设置服务持有的稳定快照对象，可以安全地交给 uSES。
     * @param form - 该命名空间的配置表单。
     * @returns 表单快照。
     */
    function useFormSnapshot(form) {
      return React.useSyncExternalStore(
        React.useCallback((onChange) => form.subscribe(onChange), [form]),
        () => form.getSnapshot(),
        () => form.getSnapshot(),
      )
    }

    /** 设置页文案。 */
    const zh = {
      nav: '品牌',
      title: '品牌定制',
      intro:
        '自定义侧边栏与会话空状态页的品牌标识和标语。两项都留空时，DSH 保持原生品牌不变。',
      logoLabel: '品牌标识 Logo',
      logoPlaceholder: 'https://example.com/logo.png 或 🐳 或一段文字',
      logoHint: '支持 http(s) 图片地址，或直接填 emoji／文字；也可以上传本地图片。',
      uploadImage: '上传图片',
      removeImage: '移除图片',
      uploadedImage: '已上传图片',
      emojiLabel: '或直接选一个 emoji',
      emojiSelected: '已选中',
      logoNotImage: '只能上传图片文件',
      logoTooLarge: '图片不能超过 128 KB',
      logoReadFailed: '图片读取失败，请换一张',
      sloganLabel: '品牌标语 Slogan',
      sloganPlaceholder: '例如：探索未至之境',
      sloganHint: '最多 60 个字符，显示在侧边栏品牌名与会话空状态页标题处。',
      preview: '预览',
      save: '保存',
      reset: '恢复默认',
      saved: '已保存',
      failed: '保存失败，请重试',
      busy: '保存中…',
    }
    const en = {
      nav: 'Brand',
      title: 'Custom brand',
      intro:
        'Customize the brand mark and slogan in the sidebar and on the blank-session hero. Leave both empty to keep the stock DSH brand.',
      logoLabel: 'Brand mark',
      logoPlaceholder: 'https://example.com/logo.png, 🐳, or plain text',
      logoHint: 'Accepts an http(s) image URL or plain emoji/text; you can also upload a local image.',
      uploadImage: 'Upload image',
      removeImage: 'Remove image',
      uploadedImage: 'Uploaded image',
      emojiLabel: 'Or pick an emoji',
      emojiSelected: 'Selected',
      logoNotImage: 'Only image files are accepted',
      logoTooLarge: 'Image must be 128 KB or smaller',
      logoReadFailed: 'Could not read the image, try another one',
      sloganLabel: 'Brand slogan',
      sloganPlaceholder: 'e.g. Into the Unknown',
      sloganHint: 'Up to 60 characters, shown beside the sidebar brand and on the hero headline.',
      preview: 'Preview',
      save: 'Save',
      reset: 'Reset',
      saved: 'Saved',
      failed: 'Could not save',
      busy: 'Saving…',
    }

    /**
     * 往文档 head 注入一次英雄区标题隐藏规则。
     * 规则本身自限定作用域（要求容器直接子 span 里带我们的标记属性），
     * 因此只有装了本插件的页面才会生效。
     */
    function installHeroStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(HERO_CSS_ID)}]`)) return
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-plugin-custom-brand'
      tag.dataset.pluginCss = HERO_CSS_ID
      tag.textContent = HERO_CSS
      document.head.appendChild(tag)
    }

    /** 需要设置服务、槽位与文案服务。 */
    const inject = ['slots', 'locale', 'configForms']

    /**
     * 插件主体。
     * @param ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'custom-brand: dictionaries')
      installHeroStyle()

      const form = ctx.configForms.get(ENTRY_ID)

      /**
       * 设置页：编辑 logo / 标语，带即时预览。
       * @returns 设置页元素。
       */
      function BrandSection() {
        const snapshot = useFormSnapshot(form)
        const value = snapshot.value ?? {}
        const savedLogo = typeof value.logo === 'string' ? value.logo : ''
        const savedSlogan = typeof value.slogan === 'string' ? value.slogan : ''
        const [logo, setLogo] = React.useState(savedLogo)
        const [slogan, setSlogan] = React.useState(savedSlogan)
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        /** 隐藏的文件选择框：上传按钮只负责把它点开。 */
        const fileInput = React.useRef(null)

        // 远端值变化（保存成功、恢复默认、别处改了补丁）时把草稿对齐回来。
        React.useEffect(() => {
          setLogo(savedLogo)
          setSlogan(savedSlogan)
        }, [savedLogo, savedSlogan])

        const dirty = logo !== savedLogo || slogan !== savedSlogan
        /** 当前 logo 是不是上传出来的图片（data URI）。 */
        const uploaded = logo.startsWith('data:')

        /**
         * 读取用户选中的图片文件。类型与体积不合法时如实提示，不静默失败。
         * @param event - 文件选择框的 change 事件。
         */
        const pickFile = (event) => {
          const file = event.target.files?.[0]
          // 清空 value，否则连续选同一个文件不会再触发 change。
          event.target.value = ''
          if (file === undefined) return
          readImageFile(
            file,
            (dataUri) => {
              setLogo(dataUri)
              setNotice(null)
            },
            (key) => setNotice(key),
          )
        }

        /** 写入两个字段；任一被宿主拒绝就如实报告失败。 */
        const commit = async () => {
          setBusy(true)
          setNotice(null)
          let accepted = true
          try {
            if (logo !== savedLogo) accepted = (await form.set('logo', logo)) && accepted
            if (slogan !== savedSlogan) accepted = (await form.set('slogan', slogan)) && accepted
          } catch (_error) {
            accepted = false
          }
          setBusy(false)
          setNotice(accepted ? 'saved' : 'failed')
        }

        /** 清掉用户层，回到 schema 默认值（即原生品牌）。 */
        const reset = async () => {
          setBusy(true)
          setNotice(null)
          let accepted = true
          try {
            if (savedLogo !== '') accepted = (await form.unset('logo')) && accepted
            if (savedSlogan !== '') accepted = (await form.unset('slogan')) && accepted
          } catch (_error) {
            accepted = false
          }
          setBusy(false)
          setNotice(accepted ? 'saved' : 'failed')
        }

        const fieldStyle = {
          width: '100%',
          boxSizing: 'border-box',
          height: 36,
          padding: '0 10px',
          font: 'inherit',
          fontSize: 13,
          color: 'var(--dsw-alias-label-primary)',
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '0.5px solid var(--dsw-alias-border-l2)',
          borderRadius: 8,
          outline: 'none',
        }
        const hintStyle = {
          margin: '6px 0 0',
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-secondary)',
        }
        const buttonStyle = {
          height: 32,
          padding: '0 14px',
          font: 'inherit',
          fontSize: 13,
          color: 'var(--dsw-alias-label-primary)',
          background: 'transparent',
          border: '0.5px solid var(--dsw-alias-border-l2)',
          borderRadius: 8,
          cursor: 'pointer',
        }
        const draftLogo = normalizeLogo(logo)
        const draftSlogan = normalize(slogan, SLOGAN_MAX)
        const emojiButtonStyle = (selected) => ({
          width: 34,
          height: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 19,
          lineHeight: 1,
          padding: 0,
          cursor: 'pointer',
          color: 'var(--dsw-alias-label-primary)',
          background: selected ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-1)',
          border: `0.5px solid ${selected ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
          borderRadius: 8,
        })

        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 } },
          h(
            'div',
            null,
            h(
              'div',
              { style: { fontSize: 16, fontWeight: 500, lineHeight: '24px' } },
              t('title'),
            ),
            h('p', { style: { ...hintStyle, marginTop: 4 } }, t('intro')),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { style: { fontSize: 13, lineHeight: '20px' } }, t('logoLabel')),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h(
                'span',
                {
                  'aria-hidden': 'true',
                  style: {
                    width: 36,
                    height: 36,
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--dsw-alias-bg-layer-1)',
                    border: '0.5px solid var(--dsw-alias-border-l2)',
                    borderRadius: 8,
                  },
                },
                draftLogo === '' ? null : h(Logo, { value: draftLogo, size: 26 }),
              ),
              uploaded
                ? h(
                    'span',
                    {
                      style: {
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        color: 'var(--dsw-alias-label-secondary)',
                      },
                    },
                    t('uploadedImage'),
                  )
                : h('input', {
                    type: 'text',
                    value: logo,
                    spellCheck: false,
                    placeholder: t('logoPlaceholder'),
                    maxLength: LOGO_TEXT_MAX,
                    style: { ...fieldStyle, flex: 1, width: 'auto', minWidth: 0 },
                    onChange: (event) => setLogo(event.target.value),
                  }),
              h('input', {
                ref: fileInput,
                type: 'file',
                accept: 'image/*',
                style: { display: 'none' },
                onChange: pickFile,
              }),
              uploaded
                ? h(
                    'button',
                    {
                      type: 'button',
                      style: { ...buttonStyle, flex: 'none' },
                      onClick: () => {
                        setLogo('')
                        setNotice(null)
                      },
                    },
                    t('removeImage'),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      style: { ...buttonStyle, flex: 'none' },
                      onClick: () => fileInput.current?.click(),
                    },
                    t('uploadImage'),
                  ),
            ),
            h('span', { style: hintStyle }, t('logoHint')),
            h(
              'div',
              null,
              h(
                'div',
                { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
                t('emojiLabel'),
              ),
              h(
                'div',
                {
                  role: 'group',
                  'aria-label': t('emojiLabel'),
                  style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(10, 34px)',
                    gap: 6,
                    marginTop: 8,
                  },
                },
                EMOJI_CHOICES.map((emoji) => {
                  const selected = logo === emoji
                  return h(
                    'button',
                    {
                      key: emoji,
                      type: 'button',
                      title: selected ? `${emoji} ${t('emojiSelected')}` : emoji,
                      'aria-label': emoji,
                      'aria-pressed': selected ? 'true' : 'false',
                      style: emojiButtonStyle(selected),
                      onClick: () => {
                        setLogo(emoji)
                        setNotice(null)
                      },
                    },
                    emoji,
                  )
                }),
              ),
            ),
          ),
          h(
            'label',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { style: { fontSize: 13, lineHeight: '20px' } }, t('sloganLabel')),
            h('input', {
              type: 'text',
              value: slogan,
              spellCheck: false,
              placeholder: t('sloganPlaceholder'),
              maxLength: SLOGAN_MAX,
              style: fieldStyle,
              onChange: (event) => setSlogan(event.target.value),
            }),
            h('span', { style: hintStyle }, t('sloganHint')),
          ),
          h(
            'div',
            null,
            h(
              'div',
              { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' } },
              t('preview'),
            ),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 8,
                  padding: '10px 14px',
                  minHeight: 44,
                  borderRadius: 10,
                  background: 'var(--dsw-specific-sidebar-fill)',
                  color: 'var(--dsw-alias-label-primary)',
                },
              },
              draftLogo ? h(Logo, { value: draftLogo, size: 24 }) : null,
              draftSlogan ? h(Slogan, { value: draftSlogan }) : null,
              !draftLogo && !draftSlogan
                ? h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('intro'))
                : null,
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(
              'button',
              {
                type: 'button',
                disabled: busy || !dirty,
                style: {
                  ...buttonStyle,
                  opacity: busy || !dirty ? 0.5 : 1,
                  cursor: busy || !dirty ? 'default' : 'pointer',
                  background: 'var(--dsw-alias-brand-primary)',
                  borderColor: 'var(--dsw-alias-brand-primary)',
                  color: 'var(--dsw-alias-bg-base)',
                },
                onClick: commit,
              },
              busy ? t('busy') : t('save'),
            ),
            h(
              'button',
              { type: 'button', disabled: busy, style: buttonStyle, onClick: reset },
              t('reset'),
            ),
            notice !== null
              ? h(
                  'span',
                  {
                    style: {
                      fontSize: 12,
                      color:
                        notice === 'saved'
                          ? 'var(--dsw-alias-state-success-primary)'
                          : 'var(--dsw-alias-state-error-primary)',
                    },
                  },
                  t(notice),
                )
              : null,
          ),
        )
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'brand',
            order: 20,
            label: () => t('nav'),
            locale: NS,
          },
          BrandSection,
        ),
      )

      // 配置变化时重建 occupant：single 槽位按 priority 覆盖原生品牌（数字越小越靠前），
      // 字段清空后则整体撤销占用，让原生品牌自己回来。
      ctx.effect(() => {
        let disposers = []
        const release = () => {
          while (disposers.length > 0) disposers.pop()()
        }
        const sync = () => {
          release()
          const value = form.getSnapshot().value ?? {}
          const logo = normalizeLogo(value.logo)
          const slogan = normalize(value.slogan, SLOGAN_MAX)

          if (logo !== '') {
            const SidebarMark = (props) => h(Logo, { value: logo, size: props.size ?? 24 })
            disposers.push(
              ctx.slots.inject('sidebar.brand.mark', () =>
                ctx.slots.register(
                  { name: 'sidebar.brand.mark', priority: -1 },
                  SidebarMark,
                ),
              ),
            )
          }
          if (slogan !== '') {
            const SidebarSlogan = () => h(Slogan, { value: slogan })
            disposers.push(
              ctx.slots.inject('sidebar.brand.name', () =>
                ctx.slots.register(
                  { name: 'sidebar.brand.name', priority: -1 },
                  SidebarSlogan,
                ),
              ),
            )
          }
          if (logo !== '' || slogan !== '') {
            // 带标记属性时，上面那条 CSS 会隐藏紧随其后的原生标题组。
            const HeroBrand = (props) =>
              h(
                'span',
                {
                  ...(slogan !== '' ? { 'data-dsh-brand-slogan': '' } : {}),
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    minWidth: 0,
                  },
                },
                logo !== '' ? h(Logo, { value: logo, size: props.size ?? 34 }) : null,
                slogan !== '' ? h(Slogan, { value: slogan }) : null,
              )
            disposers.push(
              ctx.slots.inject('conversation.hero.brand.mark', () =>
                ctx.slots.register(
                  { name: 'conversation.hero.brand.mark', priority: -1 },
                  HeroBrand,
                ),
              ),
            )
          }
        }
        const off = form.subscribe(sync)
        sync()
        return () => {
          off()
          release()
        }
      }, 'custom-brand: brand occupants')
    }

    // 纯函数单独暴露，供 test/client.test.mjs 在没有 DOM 的环境里直接断言。
    return {
      inject,
      apply,
      __internals: { normalize, normalizeLogo, isImageSource, formatBytes, EMOJI_CHOICES, UPLOAD_MAX_BYTES },
    }
  },
})
