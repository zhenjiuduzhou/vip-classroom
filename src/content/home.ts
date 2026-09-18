// 首页内容来源：用户提供的文案与四档产品附件。内容数据不自动授予课程权限。
export const homeContent = {
  brand: { name: 'AI Agent · AI FDE', tagline: '把 AI 技术做成可成交的服务' },
  navigation: ['课程', '课程优势', '学员成果'],
  hero: {
    eyebrow: 'AI 技术 × 项目实践 × 商业执行',
    title: '把 AI 技术，变成客户愿意付费的服务',
    description: '系统学习 Claude Code、n8n、Vibe Coding、AI Agent、RAG 和 Voice Agent，做出能展示给客户的 Demo，再走向服务设计、获客、报价与交付。',
    primaryAction: '了解 VIP 路线',
    secondaryAction: '查看课程体系',
  },
  challenges: {
    title: '学了很多 AI，下一步怎么走？',
    items: ['看过很多教程，却不知道如何变现', '会用工具，却不知道如何包装服务', '想接自动化项目，却不知道从哪里开始', '不清楚如何找客户、报价和成交', '想做 AI Agency，却缺少可执行的路线图'],
  },
  goal: {
    title: '用 90 天，推进你的第一个 AI 服务项目',
    description: '从一个可以展示的 Demo 出发，明确目标客户、设计 Offer、尝试获客、学习报价与销售沟通，并争取拿下第一个付费客户。',
    stages: [
      { title: '做出 Demo', description: '选择具体场景，搭建可演示的 AI 服务，整理作品集。' },
      { title: '设计 Offer', description: '明确为谁解决什么问题，形成服务范围、价值表达和报价。' },
      { title: '触达客户', description: '运用 Cold Email、Loom 和 LinkedIn，测试并调整获客方式。' },
      { title: '成交与交付', description: '练习需求沟通、Proposal 和交付计划，推进真实客户机会。' },
    ],
  },
  curriculum: {
    title: '连接技术能力与商业实践的课程体系',
    items: [
      { title: 'AI Agent 与自动化', description: 'Agent 工作流、工具调用和实际业务场景。' },
      { title: 'Claude Code 与 Vibe Coding', description: '从想法到可演示的应用，学习开发与迭代方法。' },
      { title: 'n8n 自动化系统', description: '连接数据、工具和业务流程，构建自动化方案。' },
      { title: 'RAG 与 AI 助手', description: '围绕企业资料构建知识库与问答助手。' },
      { title: 'AI Voice Agent', description: '理解语音 Agent 的应用场景与实现路径。' },
      { title: 'Offer、获客与成交', description: '服务设计、客户画像、触达、报价和 Proposal。' },
    ],
    note: '具体课程与资源以实际上线目录和各档服务约定为准。',
  },
  advantages: [
    { title: '有顺序的学习路径', description: '从基础认知到项目搭建，再到服务设计，明确每一步要完成什么。' },
    { title: '以可展示的项目为中心', description: '将知识用在具体场景中，积累 Demo 与作品集。' },
    { title: '按需要选择支持深度', description: '视频学习、项目指导与商业陪跑分档提供，服务边界清楚。' },
  ],
  products: [
    { id: 'L1', title: 'AI Agent 基础课', price: '¥99', period: '买断', audience: '想先了解 AI Agent、尝试基础工具的入门用户', features: ['基础认知与入门视频', '有顺序的学习路径', '学习已交付版本'], boundary: '不含更新、答疑、人工安装协助或项目指导。' },
    { id: 'L2', title: 'AI Agent 进阶会员', price: '¥199/月', annualPrice: '¥1,990/年', audience: '能通过视频自学、希望持续学习的用户', features: ['包含基础内容与进阶视频', '订阅期内持续更新', '针对课程概念、步骤和示例的有限答疑'], boundary: '不含个人环境排障、私人项目指导、定制 Debug 或商业陪跑。' },
    { id: 'L3', title: 'AI FDE 实战会员', price: '¥699/月', annualPrice: '¥6,990/年', audience: '希望独立做出 AI 项目、学习企业服务方法的用户', features: ['包含 L2 内容', '安装、环境配置与项目实践指导', 'Debug、部署与优化答疑', 'Demo、Portfolio、Offer、获客与报价教学'], boundary: '指导不等于代开发或代部署；不含持续获客追踪及全程成交交付陪跑。' },
    { id: 'L4', title: 'AI FDE 商业陪跑', price: '¥5,999', period: '90天', guarantee: '90天内拿下首个 AI 付费客户，否则全额退款。', audience: '准备实际开展 AI 服务业务、愿意投入时间执行的用户', features: ['包含陪跑期内的 L3 内容', '行业与客户画像、Demo 和 Offer', '获客执行、销售沟通与 Proposal', '行动计划、执行检查和客户反馈复盘'], boundary: '触达、谈判、签约和交付由学员完成；不代获客、不代开发，第三方费用另计。' },
  ],
  outcomes: {
    title: '你的目标，是形成可以展示的成果',
    items: ['一个可演示的 AI 服务 Demo', '一份说明能力与场景的作品集', '一个边界清晰的服务 Offer', '真实客户触达记录与反馈', '可继续推进的销售和交付计划'],
    note: '这里展示目标成果。真实学员案例经核实与授权后再加入，不使用虚构评价。',
  },
  fit: {
    title: '适合愿意持续行动的人',
    suitable: '如果你愿意学、愿意做、愿意提交问题并执行计划，可以按需要选择视频会员、项目指导或商业陪跑。',
    unsuitable: '如果你只想收藏课程，或期待加入后无需执行就自动获得客户，这套学习与实践方式不适合你。',
  },
  faq: [
    { question: '90天首单退款承诺适用于哪一档？', answer: '适用于 L4 AI FDE 商业陪跑。90天内未拿下首个 AI 付费客户，全额退还该档报名费；不以完成行动任务为退款前提。' },
    { question: '四档产品如何选择？', answer: '先体验基础选 L1；需要系统视频与更新选 L2；需要项目指导与商业方法选 L3；准备推进真实业务、需要执行反馈选 L4。' },
    { question: '网站上可以直接购买吗？', answer: '当前采用线下报名。注册后由管理员开通对应课程等级和有效期，网站不提供在线支付。' },
    { question: '年付包含多久？', answer: 'L2 与 L3 年付按月价的十倍定价，提供十二个月同档权益。' },
    { question: '会帮我代开发或直接提供客户吗？', answer: '不会。项目指导和商业陪跑提供方法、反馈与执行支持，具体开发、客户触达、谈判和交付仍需你完成。' },
  ],
  closing: {
    title: '开始把 AI 能力用在真实问题上',
    description: '从 Demo 到服务方案，从客户沟通到交付，选择适合你当前阶段的 VIP 路线。',
    action: '了解 VIP，开始行动',
  },
} as const;

// 用户确认覆盖附件中的延期保障；不附加行动任务前提。
export const commercialGuarantee = {
  productId: 'L4',
  durationDays: 90,
  copy: '加入 L4 商业陪跑，90天内拿下首个 AI 付费客户，否则全额退款。',
  requiresCompletedTasks: false,
  status: 'confirmed',
} as const;
