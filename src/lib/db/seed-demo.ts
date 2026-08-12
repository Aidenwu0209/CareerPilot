import {
  careerAbilities,
  careerEvidence,
  careerGoals,
  careerGuidanceNotes,
  careerProfiles,
  careerProfileSnapshots,
  careerTasks,
  educationRoleAssignments,
  occupations,
  organizationMemberships,
  organizations,
  resumeSections,
  resumes,
  teacherStudentAssignments,
  users,
} from './schema';
import { and, eq } from 'drizzle-orm';
import { DEMO_OCCUPATIONS } from '@/lib/career/catalog';

export const DEMO_STUDENT_FINGERPRINT = 'demo-fingerprint';
export const DEMO_TEACHER_FINGERPRINT = 'teacher-demo-fingerprint';
export const DEMO_SCHOOL_SLUG = 'careerpilot-demo-school';

/**
 * Ensure the fixed local demo identities are connected to an active teacher
 * workspace. This is idempotent so `pnpm db:seed` also repairs older local
 * databases that predate the teacher demo.
 */
export async function ensureDemoTeacherWorkspace(db: any, studentUserId: string) {
  const [existingTeacher] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.fingerprint, DEMO_TEACHER_FINGERPRINT))
    .limit(1);
  const teacherId = existingTeacher?.id ?? crypto.randomUUID();

  if (!existingTeacher) {
    await db.insert(users).values({
      id: teacherId,
      name: '周老师',
      authType: 'fingerprint',
      fingerprint: DEMO_TEACHER_FINGERPRINT,
    });
  }

  const [existingOrganization] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, DEMO_SCHOOL_SLUG))
    .limit(1);
  const organizationId = existingOrganization?.id ?? crypto.randomUUID();

  if (!existingOrganization) {
    await db.insert(organizations).values({
      id: organizationId,
      slug: DEMO_SCHOOL_SLUG,
      name: 'CareerPilot 演示学院',
      status: 'active',
      seatLimit: 50,
      createdBy: teacherId,
    });
  }

  await db.insert(organizationMemberships).values([
    { organizationId, userId: studentUserId, role: 'member', status: 'active' },
    { organizationId, userId: teacherId, role: 'member', status: 'active' },
  ]).onConflictDoNothing();
  await db.update(organizationMemberships).set({ status: 'active' }).where(
    and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.userId, studentUserId),
    ),
  );
  await db.update(organizationMemberships).set({ status: 'active' }).where(
    and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.userId, teacherId),
    ),
  );

  await db.insert(educationRoleAssignments).values([
    { organizationId, userId: studentUserId, role: 'student', status: 'active' },
    { organizationId, userId: teacherId, role: 'teacher', status: 'active' },
  ]).onConflictDoNothing();
  await db.update(educationRoleAssignments).set({ status: 'active' }).where(
    and(
      eq(educationRoleAssignments.organizationId, organizationId),
      eq(educationRoleAssignments.userId, studentUserId),
      eq(educationRoleAssignments.role, 'student'),
    ),
  );
  await db.update(educationRoleAssignments).set({ status: 'active' }).where(
    and(
      eq(educationRoleAssignments.organizationId, organizationId),
      eq(educationRoleAssignments.userId, teacherId),
      eq(educationRoleAssignments.role, 'teacher'),
    ),
  );
  await db.insert(teacherStudentAssignments).values({
    organizationId,
    teacherUserId: teacherId,
    studentUserId,
    status: 'active',
    accessLevel: 'guide',
  }).onConflictDoNothing();
  await db.update(teacherStudentAssignments).set({
    status: 'active',
    accessLevel: 'guide',
  }).where(
    and(
      eq(teacherStudentAssignments.organizationId, organizationId),
      eq(teacherStudentAssignments.teacherUserId, teacherId),
      eq(teacherStudentAssignments.studentUserId, studentUserId),
    ),
  );

  return { teacherId, organizationId };
}

/**
 * Seed a demo-fingerprint user with a sample resume.
 * Called automatically when the database is empty.
 */
export async function seedDemoUser(db: any) {
  const userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    name: '陈思远',
    authType: 'fingerprint',
    fingerprint: DEMO_STUDENT_FINGERPRINT,
    settings: { program: '软件工程', cohort: '2027 届' },
  });

  const resumeId = crypto.randomUUID();
  await db.insert(resumes).values({
    id: resumeId,
    userId,
    title: '示例简历 - 陈思远',
    template: 'modern',
    language: 'zh',
  });

  const sections = [
    {
      type: 'personal_info',
      title: '个人信息',
      sortOrder: 0,
      content: {
        fullName: '陈思远',
        jobTitle: '高级前端工程师',
        email: 'siyuan.chen@example.com',
        phone: '138-0013-8000',
        location: '成都',
        website: 'https://chensiyuan.dev',
      },
    },
    {
      type: 'summary',
      title: '个人简介',
      sortOrder: 1,
      content: {
        text: '拥有 6 年前端开发经验的高级工程师，专注于 React 生态和现代 Web 技术栈。曾主导多个大型 SaaS 产品的前端架构设计与性能优化，将核心页面加载时间缩短 60%。擅长将复杂业务需求转化为优雅的技术方案，对代码质量和用户体验有极高追求。',
      },
    },
    {
      type: 'work_experience',
      title: '工作经历',
      sortOrder: 2,
      content: {
        items: [
          {
            id: crypto.randomUUID(),
            company: '字节跳动',
            position: '高级前端工程师',
            location: '成都',
            startDate: '2022-03',
            endDate: null,
            current: true,
            description: '负责飞书文档协同编辑模块的前端架构设计与核心功能开发。',
            highlights: [
              '主导设计并实现了基于 CRDT 的实时协同编辑引擎，支持万人同时在线编辑',
              '搭建前端性能监控体系，推动核心指标 LCP 从 3.2s 优化至 1.1s',
              '设计组件库的微前端架构方案，实现跨团队组件复用率提升 40%',
            ],
          },
          {
            id: crypto.randomUUID(),
            company: '蚂蚁集团',
            position: '前端工程师',
            location: '杭州',
            startDate: '2019-07',
            endDate: '2022-02',
            current: false,
            description: '参与支付宝小程序平台的开发与维护，负责开发者工具链建设。',
            highlights: [
              '从零搭建小程序 IDE 的插件系统，支持 200+ 第三方插件接入',
              '优化小程序编译流程，构建速度提升 3 倍，显著改善开发者体验',
              '主导前端单元测试覆盖率从 30% 提升至 85%，减少线上故障率 50%',
            ],
          },
          {
            id: crypto.randomUUID(),
            company: '美团',
            position: '前端开发实习生',
            location: '北京',
            startDate: '2018-06',
            endDate: '2019-06',
            current: false,
            description: '参与美团外卖商家端 B 端系统的前端开发。',
            highlights: [
              '独立完成订单管理模块的重构，使用 React Hooks 替换 Class 组件',
              '封装通用表格和表单组件，被团队广泛采用',
            ],
          },
        ],
      },
    },
    {
      type: 'education',
      title: '教育背景',
      sortOrder: 3,
      content: {
        items: [
          {
            id: crypto.randomUUID(),
            institution: '电子科技大学',
            degree: '硕士',
            field: '软件工程',
            location: '成都',
            startDate: '2016-09',
            endDate: '2019-06',
            gpa: '3.8/4.0',
            highlights: ['研究方向：Web 前端性能优化与可视化', '校级优秀毕业论文'],
          },
          {
            id: crypto.randomUUID(),
            institution: '四川大学',
            degree: '学士',
            field: '计算机科学与技术',
            location: '成都',
            startDate: '2012-09',
            endDate: '2016-06',
            gpa: '3.6/4.0',
            highlights: [],
          },
        ],
      },
    },
    {
      type: 'skills',
      title: '技能特长',
      sortOrder: 4,
      content: {
        categories: [
          { id: crypto.randomUUID(), name: '前端框架', skills: ['React', 'Next.js', 'Vue 3', 'TypeScript'] },
          { id: crypto.randomUUID(), name: '工程化', skills: ['Webpack', 'Vite', 'Turborepo', 'CI/CD'] },
          { id: crypto.randomUUID(), name: '其他', skills: ['Node.js', 'Docker', 'PostgreSQL', 'Figma'] },
        ],
      },
    },
    {
      type: 'projects',
      title: '项目经历',
      sortOrder: 5,
      content: {
        items: [
          {
            id: crypto.randomUUID(),
            name: 'CareerPilot 简历助手',
            url: 'https://github.com/example/careerpilot',
            startDate: '2024-10',
            endDate: '2025-02',
            description: '基于 AI 的智能简历生成与优化工具，支持多模板、实时预览和 AI 对话式编辑。',
            technologies: ['Next.js', 'React 19', 'Tailwind CSS', 'Vercel AI SDK'],
            highlights: [
              '使用 AI SDK 实现流式对话与简历内容自动填充',
              '设计三套专业简历模板，支持实时预览与 PDF 导出',
            ],
          },
        ],
      },
    },
  ];

  for (const section of sections) {
    await db.insert(resumeSections).values({
      id: crypto.randomUUID(),
      resumeId,
      ...section,
    } as any);
  }

  // The demo seed also exposes the smallest auditable career-development loop:
  // reviewed occupation knowledge -> student evidence/profile -> goal/tasks ->
  // explicitly assigned teacher guidance. It is only used for a fresh local DB.
  const goalId = crypto.randomUUID();
  const { teacherId } = await ensureDemoTeacherWorkspace(db, userId);

  for (const occupation of DEMO_OCCUPATIONS) {
    await db.insert(occupations).values({
      code: occupation.code,
      name: occupation.name,
      category: occupation.category,
      summary: occupation.summary,
      description: occupation.description,
      entryLevel: occupation.entryLevel,
      active: true,
    });
  }

  await db.insert(careerProfiles).values({
    userId,
    headline: '面向前端工程方向的软件工程学生',
    summary: '已完成响应式 Web 项目，正在补充测试、部署和面试表达证据。',
    stage: 'preparing',
    completeness: 78,
    evidenceCoverage: 67,
  });

  const abilitySeeds = [
    { code: 'software_fundamentals', name: '软件工程基础', dimension: 'domain_knowledge', score: 68, confidence: 78, evidenceCount: 1 },
    { code: 'web_frontend', name: 'Web 前端基础', dimension: 'professional_skills', score: 76, confidence: 88, evidenceCount: 2 },
    { code: 'project_delivery', name: '项目交付', dimension: 'project_practice', score: 64, confidence: 72, evidenceCount: 1 },
    { code: 'problem_solving', name: '问题分析与解决', dimension: 'general_competencies', score: 70, confidence: 74, evidenceCount: 1 },
    { code: 'portfolio', name: '作品与成果证明', dimension: 'job_readiness', score: 58, confidence: 62, evidenceCount: 1 },
    { code: 'continuous_learning', name: '持续学习', dimension: 'growth_potential', score: 73, confidence: 70, evidenceCount: 1 },
  ] as const;
  await db.insert(careerAbilities).values(abilitySeeds.map((ability) => ({ userId, ...ability })));

  await db.insert(careerEvidence).values([
    {
      userId,
      abilityCode: 'web_frontend',
      sourceType: 'project',
      sourceId: resumeId,
      title: 'CareerPilot 响应式前端项目',
      excerpt: '使用 Next.js、React 与 TypeScript 完成多端页面和实时预览，并记录个人贡献。',
      status: 'verified',
      occurredAt: new Date(),
    },
    {
      userId,
      abilityCode: 'project_delivery',
      sourceType: 'resume',
      sourceId: resumeId,
      title: '项目交付经历',
      excerpt: '具备从需求拆解、实现到部署的项目经历，部署地址仍待教师确认。',
      status: 'pending',
      occurredAt: new Date(),
    },
    {
      userId,
      abilityCode: 'problem_solving',
      sourceType: 'project',
      sourceId: resumeId,
      title: '性能问题定位与优化',
      excerpt: '通过性能监控定位加载瓶颈，并给出可复核的优化结果。',
      status: 'verified',
      occurredAt: new Date(),
    },
    {
      userId,
      abilityCode: 'portfolio',
      sourceType: 'resume',
      sourceId: resumeId,
      title: '前端作品材料',
      excerpt: '简历已呈现项目结构、技术栈与个人职责。',
      status: 'verified',
      occurredAt: new Date(),
    },
  ]);

  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + 9);
  await db.insert(careerGoals).values({
    id: goalId,
    userId,
    occupationCode: 'J-FE-001',
    isPrimary: true,
    status: 'active',
    targetDate,
    rationale: '希望从真实 Web 产品切入软件工程职业路径，并持续积累可展示的项目成果。',
    preferences: { industries: ['软件与互联网'], cities: ['成都', '深圳'], organizationTypes: ['成长型团队'] },
    teacherConfirmationStatus: 'unreviewed',
  });

  const taskDueSoon = new Date();
  taskDueSoon.setDate(taskDueSoon.getDate() + 7);
  const taskDueLater = new Date();
  taskDueLater.setDate(taskDueLater.getDate() + 21);
  await db.insert(careerTasks).values([
    {
      userId,
      goalId,
      occupationCode: 'J-FE-001',
      abilityCode: 'testing',
      title: '为核心组件补充自动化测试',
      description: '提交测试代码、覆盖的关键场景和一次可复核的测试运行结果。',
      reason: '自动化测试是目标岗位当前最明显的证据缺口。',
      completionCriteria: '新增至少 3 个关键场景测试并保存一次通过的运行结果。',
      category: 'practice',
      status: 'in_progress',
      dueAt: taskDueSoon,
    },
    {
      userId,
      goalId,
      occupationCode: 'J-FE-001',
      abilityCode: 'portfolio',
      title: '整理前端项目作品说明',
      description: '用问题、行动、结果结构说明个人贡献，并附可访问的演示或截图。',
      reason: '将已有项目转换为招聘方可快速核验的作品证据。',
      completionCriteria: '提交项目链接、三段式个人贡献说明和至少一张关键界面截图。',
      category: 'portfolio',
      status: 'todo',
      dueAt: taskDueLater,
      assignedBy: teacherId,
    },
  ]);

  const previousAbilities = abilitySeeds.map((ability) => ({
    code: ability.code,
    name: ability.name,
    dimension: ability.dimension,
    score: ability.score === 76 ? 69 : ability.score,
  }));
  const currentAbilities = abilitySeeds.map((ability) => ({
    code: ability.code,
    name: ability.name,
    dimension: ability.dimension,
    score: ability.score,
  }));
  await db.insert(careerProfileSnapshots).values([
    { userId, version: 1, abilities: previousAbilities, trigger: '导入示例简历并完成首次结构化' },
    { userId, version: 2, abilities: currentAbilities, trigger: '前端项目证据已确认' },
  ]);
  await db.insert(careerGuidanceNotes).values({
    userId,
    teacherId,
    visibility: 'student',
    content: '你的前端基础和问题分析已有证据支撑。下一步优先补齐自动化测试与可访问部署证据。',
  });

  console.log('[DB] Auto-seed complete: demo student, career profile, and assigned teacher created');
}
