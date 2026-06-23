import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// ── Config ──────────────────────────────────────────────
const SB_URL  = process.env.LEANFLOW_SB_URL  || 'https://eewyzqyxwwkdimonltjy.supabase.co';
const SB_KEY  = process.env.LEANFLOW_SB_KEY;   // service role key — required
const USER_ID = process.env.LEANFLOW_USER_ID;   // supabase user UUID — required

if (!SB_KEY)  { console.error('LEANFLOW_SB_KEY env var required'); process.exit(1); }
if (!USER_ID) { console.error('LEANFLOW_USER_ID env var required'); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Storage keys (mirror LeanFlow's K constant) ─────────
const K = {
  tasks:      'ahq_tasks',
  habits:     'ahq_habits',
  habitLog:   'ahq_habit_log',
  goals:      'ahq_goals',
  journal:    'ahq_journal',
  meetings:   'ahq_meetings',
  knowledge:  'ahq_knowledge',
  workouts:   'ahq_workouts',
  metrics:    'ahq_metrics',
  reviews:    'ahq_reviews',
  notes:      'ahq_notes',
  directory:  'ahq_directory',
  quotes:     'ahq_quotes',
  vocab:      'ahq_vocab',
};

// ── Supabase helpers ─────────────────────────────────────
async function getData(key) {
  const { data, error } = await sb
    .from('leanhq_sync')
    .select('value')
    .eq('user_id', USER_ID)
    .eq('key', key)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data?.value || [];
}

async function setData(key, value) {
  const { error } = await sb
    .from('leanhq_sync')
    .upsert(
      { user_id: USER_ID, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  if (error) throw new Error(error.message);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

// ── Tool definitions ─────────────────────────────────────
const TOOLS = [
  {
    name: 'lf_get_tasks',
    description: 'Get LeanFlow tasks. Optional filters: status (todo/done), overdue (true), due_today (true), business name.',
    inputSchema: {
      type: 'object',
      properties: {
        status:    { type: 'string', enum: ['todo', 'done'], description: 'Filter by status' },
        overdue:   { type: 'boolean', description: 'Only overdue tasks' },
        due_today: { type: 'boolean', description: 'Only tasks due today' },
        business:  { type: 'string', description: 'Filter by business label' },
        limit:     { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'lf_add_task',
    description: 'Add a task to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        due:      { type: 'string', description: 'Due date YYYY-MM-DD' },
        business: { type: 'string', description: 'Business label e.g. StreamLean, LeanFlow, Personal' },
        dept:     { type: 'string', description: 'Department e.g. Marketing, Development, Operations' },
        urgent:   { type: 'boolean' },
        important:{ type: 'boolean' },
        notes:    { type: 'string' },
      },
    },
  },
  {
    name: 'lf_complete_task',
    description: 'Mark a task as done. Use task id or an exact title match.',
    inputSchema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Task ID' },
        title: { type: 'string', description: 'Task title (exact match)' },
      },
    },
  },
  {
    name: 'lf_get_habits',
    description: 'Get all habits and whether they are completed today.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lf_log_habit',
    description: 'Log a habit as completed for today.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Habit name (partial match ok)' },
        date: { type: 'string', description: 'Date YYYY-MM-DD (defaults to today)' },
      },
    },
  },
  {
    name: 'lf_get_goals',
    description: 'Get all LeanFlow goals.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'done', 'paused'] },
      },
    },
  },
  {
    name: 'lf_add_goal',
    description: 'Add a goal to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        category: { type: 'string', description: 'Business, Health, Learning, Personal…' },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        why:      { type: 'string', description: 'Reason / motivation' },
      },
    },
  },
  {
    name: 'lf_get_notes',
    description: 'Get capture notes / ideas from LeanFlow.',
    inputSchema: {
      type: 'object',
      properties: {
        status:   { type: 'string', enum: ['open', 'scheduled', 'done', 'rejected'] },
        category: { type: 'string' },
        limit:    { type: 'number' },
      },
    },
  },
  {
    name: 'lf_add_note',
    description: 'Add a capture note or idea to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:     { type: 'string' },
        category: { type: 'string', description: 'Category / label e.g. Idea, Content, System' },
        source:   { type: 'string', description: 'Source URL or reference' },
      },
    },
  },
  {
    name: 'lf_add_lesson',
    description: 'Add a lesson to the Growth → Lessons tab in LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:  { type: 'string', description: 'What was the lesson / insight' },
        notes:  { type: 'string', description: 'Key takeaways, details' },
        source: { type: 'string', description: 'Author, creator, or platform' },
        link:   { type: 'string', description: 'Source URL' },
        type:   { type: 'string', description: 'Book, Video, Podcast, Article, Course, Other' },
        domain: { type: 'string', description: 'Marketing, Business, Sales, Mindset, etc.' },
      },
    },
  },
  {
    name: 'lf_add_skill',
    description: 'Add a skill (course, book, resource) to the Growth → Skills tab in LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        notes:    { type: 'string' },
        source:   { type: 'string' },
        link:     { type: 'string' },
        type:     { type: 'string', description: 'Book, Course, Video, Podcast, Article, Other' },
        domain:   { type: 'string' },
        status:   { type: 'string', enum: ['todo', 'active', 'done'] },
        progress: { type: 'number', description: '0-100' },
      },
    },
  },
  {
    name: 'lf_add_system',
    description: 'Add a system or framework to the Growth → Systems tab in LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:  { type: 'string', description: 'System or framework name' },
        notes:  { type: 'string', description: 'How it works, steps, when to use' },
        source: { type: 'string' },
        link:   { type: 'string' },
        domain: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_add_quote',
    description: 'Save a quote to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:     { type: 'string' },
        author:   { type: 'string' },
        source:   { type: 'string' },
        category: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_get_meetings',
    description: 'Get upcoming or recent meetings from LeanFlow.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'lf_add_meeting',
    description: 'Add a meeting to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title', 'date'],
      properties: {
        title:    { type: 'string' },
        date:     { type: 'string', description: 'YYYY-MM-DD' },
        time:     { type: 'string', description: 'HH:MM' },
        business: { type: 'string' },
        notes:    { type: 'string' },
        outcome:  { type: 'string', description: 'Closed, Follow-Up, No Show, Cancelled, Rescheduled' },
      },
    },
  },
  {
    name: 'lf_get_journal',
    description: 'Get recent journal entries from LeanFlow.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max entries (default 7)' },
      },
    },
  },
];

// ── Tool handlers ────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {

    case 'lf_get_tasks': {
      let tasks = await getData(K.tasks);
      if (args.status)    tasks = tasks.filter(t => t.status === args.status);
      if (args.overdue)   tasks = tasks.filter(t => t.due && t.due < today() && t.status !== 'done');
      if (args.due_today) tasks = tasks.filter(t => t.due === today() && t.status !== 'done');
      if (args.business)  tasks = tasks.filter(t => (t.business||'').toLowerCase().includes(args.business.toLowerCase()));
      tasks = tasks.slice(0, args.limit || 20);
      return JSON.stringify(tasks, null, 2);
    }

    case 'lf_add_task': {
      const tasks = await getData(K.tasks);
      const task = {
        id: uid(),
        title: args.title,
        status: 'todo',
        due: args.due || null,
        business: args.business || null,
        dept: args.dept || null,
        urgent: args.urgent || false,
        important: args.important || false,
        notes: args.notes || '',
        created: today(),
        ts: Date.now(),
      };
      tasks.unshift(task);
      await setData(K.tasks, tasks);
      return `Task added: "${task.title}" (id: ${task.id})`;
    }

    case 'lf_complete_task': {
      const tasks = await getData(K.tasks);
      let target;
      if (args.id)    target = tasks.find(t => t.id === args.id);
      if (!target && args.title) target = tasks.find(t => t.title === args.title);
      if (!target) return 'Task not found. Use lf_get_tasks to list tasks and find the id.';
      target.status = 'done';
      target.completedAt = today();
      await setData(K.tasks, tasks);
      return `Marked done: "${target.title}"`;
    }

    case 'lf_get_habits': {
      const habits   = await getData(K.habits);
      const habitLog = await getData(K.habitLog);
      const todayLog = (habitLog || []).filter(e => e.date === today()).map(e => e.habitId);
      const result = habits.map(h => ({
        id: h.id,
        name: h.name,
        emoji: h.emoji || '',
        done_today: todayLog.includes(h.id),
        streak: h.streak || 0,
      }));
      return JSON.stringify(result, null, 2);
    }

    case 'lf_log_habit': {
      const habits = await getData(K.habits);
      const target = habits.find(h => h.name.toLowerCase().includes(args.name.toLowerCase()));
      if (!target) return `Habit not found matching "${args.name}". Use lf_get_habits to list habits.`;
      const habitLog = await getData(K.habitLog);
      const date = args.date || today();
      const alreadyLogged = habitLog.some(e => e.habitId === target.id && e.date === date);
      if (alreadyLogged) return `"${target.name}" already logged for ${date}.`;
      habitLog.push({ id: uid(), habitId: target.id, date, ts: Date.now() });
      await setData(K.habitLog, habitLog);
      return `Logged "${target.name}" for ${date}.`;
    }

    case 'lf_get_goals': {
      let goals = await getData(K.goals);
      if (args.status) goals = goals.filter(g => g.status === args.status);
      return JSON.stringify(goals, null, 2);
    }

    case 'lf_add_goal': {
      const goals = await getData(K.goals);
      const goal = {
        id: uid(),
        title: args.title,
        category: args.category || 'Other',
        deadline: args.deadline || null,
        why: args.why || '',
        status: 'active',
        progress: 0,
        created: today(),
      };
      goals.push(goal);
      await setData(K.goals, goals);
      return `Goal added: "${goal.title}"`;
    }

    case 'lf_get_notes': {
      let notes = await getData(K.notes);
      if (args.status)   notes = notes.filter(n => (n.status||'open').toLowerCase() === args.status.toLowerCase());
      if (args.category) notes = notes.filter(n => n.category === args.category);
      notes = [...notes].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, args.limit || 20);
      return JSON.stringify(notes, null, 2);
    }

    case 'lf_add_note': {
      const notes = await getData(K.notes);
      const note = {
        id: uid(),
        text: args.text,
        category: args.category || null,
        source: args.source || '',
        status: null,
        created: today(),
        ts: Date.now(),
      };
      notes.unshift(note);
      await setData(K.notes, notes);
      return `Note added: "${args.text.slice(0, 60)}…"`;
    }

    case 'lf_add_lesson':
    case 'lf_add_skill':
    case 'lf_add_system': {
      const cat = name === 'lf_add_lesson' ? 'lessons' : name === 'lf_add_skill' ? 'skills' : 'systems';
      const items = await getData(K.knowledge);
      const entry = {
        id: uid(),
        category: cat,
        title: args.title,
        type: args.type || 'Other',
        skill: args.domain || 'Other',
        source: args.source || '',
        link: args.link || '',
        notes: args.notes || '',
        date: today(),
        ...(cat === 'skills' ? { status: args.status || 'todo', progress: args.progress || 0 } : {}),
      };
      items.push(entry);
      await setData(K.knowledge, items);
      return `${cat.slice(0, -1)} added: "${entry.title}"`;
    }

    case 'lf_add_quote': {
      const quotes = await getData(K.quotes);
      quotes.push({ id: uid(), text: args.text, author: args.author || '', source: args.source || '', category: args.category || 'Other', date: today() });
      await setData(K.quotes, quotes);
      return `Quote saved.`;
    }

    case 'lf_get_meetings': {
      const meetings = await getData(K.meetings);
      const sorted = [...meetings].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return JSON.stringify(sorted.slice(0, args.limit || 10), null, 2);
    }

    case 'lf_add_meeting': {
      const meetings = await getData(K.meetings);
      const meeting = {
        id: uid(),
        title: args.title,
        date: args.date,
        time: args.time || '',
        business: args.business || '',
        notes: args.notes || '',
        outcome: args.outcome || '',
        created: today(),
      };
      meetings.unshift(meeting);
      await setData(K.meetings, meetings);
      return `Meeting added: "${meeting.title}" on ${meeting.date}`;
    }

    case 'lf_get_journal': {
      const entries = await getData(K.journal);
      const sorted = [...entries].sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, args.limit || 7);
      return JSON.stringify(sorted, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Server ───────────────────────────────────────────
const server = new Server(
  { name: 'leanflow', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const result = await handleTool(req.params.name, req.params.arguments || {});
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
