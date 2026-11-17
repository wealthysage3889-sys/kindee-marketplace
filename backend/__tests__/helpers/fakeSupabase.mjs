// Minimal in-memory stand-in for the Supabase client used by the chat service.
//
// It implements only the query builder surface the chat code paths use
// (select/insert/update, eq/neq/lt/gt/is/in, order/range/limit, single) and
// records every call so tests can assert what was written. Nothing here talks
// to the network or to a real database.
//
// Tables seeded from the `seed` argument: profiles, stores, conversations,
// conversation_members, messages, message_attachments, notifications.

const clone = (value) => {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
};

const sameValue = (left, right) => String(left ?? null) === String(right ?? null);

const MISSING_ROW = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };

export function createFakeSupabase(seed = {}) {
  const baseTables = {
    profiles: new Map(seed.profiles || []),
    stores: new Map(seed.stores || []),
    conversations: new Map(seed.conversations || []),
    conversation_members: new Map(seed.conversation_members || []),
    messages: new Map(seed.messages || []),
    message_attachments: new Map(seed.message_attachments || []),
    notifications: new Map(seed.notifications || []),
    settings: new Map(seed.settings || []),
  };
  const tables = { ...baseTables };
  for (const [name, rows] of Object.entries(seed || {})) {
    if (!tables[name]) tables[name] = new Map(rows || []);
  }

  const calls = [];
  const rpcCalls = [];
  let seq = 0;
  const nextId = (prefix) => `${prefix}-generated-${++seq}`;

  // Column defaults applied by the real schema, so rows behave like Postgres rows.
  const columnDefaults = {
    messages: { type: 'text', is_edited: false, is_deleted: false, deleted_at: null, metadata: {} },
    conversation_members: { role: 'member', left_at: null, last_read_at: null, unread_count: 0, is_muted: false },
    conversations: { type: 'direct', title: null, last_message_at: null, metadata: {} },
    message_attachments: { width: null, height: null, duration_seconds: null, thumbnail_url: null },
    notifications: { is_read: false, data: {} },
    call_history: { status: 'ringing', metadata: {}, answered_at: null, ended_at: null, end_reason: null, duration_seconds: null },
  };

  const withDefaults = (table, payload) => ({
    ...(columnDefaults[table] || {}),
    ...clone(payload),
  });

  const membersOf = (conversationId) =>
    [...tables.conversation_members.values()].filter((m) => m.conversation_id === conversationId);

  const attachmentsOf = (messageId) =>
    [...tables.message_attachments.values()].filter((a) => a.message_id === messageId);

  const hydrateConversation = (row) => {
    if (!row) return null;
    const store = row.store_id ? tables.stores.get(row.store_id) : null;
    const lastMessage = [...tables.messages.values()]
      .filter((m) => m.conversation_id === row.id && m.is_deleted === false)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    return {
      ...clone(row),
      members: membersOf(row.id).map(clone),
      store: store ? clone(store) : null,
      last_message: lastMessage ? clone(lastMessage) : null,
    };
  };

  const hydrateMessage = (row) => {
    if (!row) return null;
    const sender = tables.profiles.get(row.sender_id);
    return {
      ...clone(row),
      sender: sender ? clone(sender) : null,
      attachments: attachmentsOf(row.id).map(clone),
    };
  };

  const comparable = (value) => {
    if (value === null || value === undefined) return null;
    // ISO timestamp strings are compared as instants, never lexicographically.
    if (typeof value === 'string') {
      const time = Date.parse(value);
      if (!Number.isNaN(time) && /T.*Z$|[+-]\d\d:\d\d$/.test(value)) return time;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? value : time;
  };

  const rowMatches = (row, column, expected) => {
    if (column.startsWith('is.')) {
      const key = column.slice(3);
      const actual = row[key] === undefined ? null : row[key];
      return actual === expected;
    }

    if (column.startsWith('in.')) {
      const key = column.slice(3);
      const list = Array.isArray(expected) ? expected : [];
      return list.some((item) => sameValue(item, row[key]));
    }

    if (column.startsWith('eq.')) {
      const key = column.slice(4);
      return sameValue(row[key], expected);
    }

    if (column.startsWith('neq.')) {
      const key = column.slice(4);
      return !sameValue(row[key], expected);
    }

    // Comparison filters arrive as `lt.<column>` / `gt.<column>` from the
    // builder; values are compared with `comparable()` so ISO timestamps are
    // ordered as instants (a raw string compare would be lexicographic).
    const comparisonMatch = (opColumn, expectedValue) => {
      const opMatch = opColumn.match(/^(gt|gte|lt|lte)\.(.+)$/);
      const operator = opMatch ? opMatch[1] : null;
      const column = opMatch ? opMatch[2] : opColumn;
      const actualValue = comparable(row[column]);
      const targetValue = comparable(expectedValue);
      if (actualValue === null || targetValue === null) return false;
      if (operator === 'gt') return actualValue > targetValue;
      if (operator === 'gte') return actualValue >= targetValue;
      if (operator === 'lt') return actualValue < targetValue;
      return actualValue <= targetValue;
    };

    if (/^(gt|gte|lt|lte)\./.test(column)) {
      return comparisonMatch(column, expected);
    }

    // Embedded filter such as `conversation_members.profile_id`.
    if (column.startsWith('conversation_members.')) {
      const key = column.split('.')[1];
      if (key === 'profile_id') {
        return membersOf(row.id).some(
          (member) => sameValue(member.profile_id, expected) && !member.left_at
        );
      }
      if (key === 'left_at') {
        return membersOf(row.id).every((member) => (member.left_at ?? null) === expected);
      }
      return true;
    }

    if (column.startsWith('messages.')) {
      return true;
    }

    return sameValue(row[column], expected);
  };

  const rowsFor = (table) => {
    const filters = Object.entries(state0.filters);
    const orExpr = state0.filters.__or;
    const orClauses = state0.orClauses || [];
    const rest = filters.filter(([k]) => k !== '__or');

    const matchOr = (row) => {
      if (!orExpr) return true;
      return String(orExpr)
        .split(',')
        .map((clause) => clause.trim())
        .filter(Boolean)
        .some((clause) => {
          // Support `col.is.null` (SQL NULL check) in addition to `col.op.value`.
          const nullMatch = clause.match(/^([a-zA-Z0-9_.]+)\.is\.null$/);
          if (nullMatch) {
            const col = nullMatch[1];
            const actual = row[col];
            return actual === null || actual === undefined;
          }
          const m = clause.match(/^([a-zA-Z0-9_.]+)\.(eq|neq|gt|gte|lt|lte)\.(.*)$/);
          if (!m) return false;
          const [, column, operator, rawValue] = m;
          // rowMatches handles `neq.` and comparison operators natively; for `eq`
          // we pass the bare column name so it falls through to sameValue.
          if (operator === 'eq') {
            return rowMatches(row, column, rawValue);
          }
          return rowMatches(row, `${operator}.${column}`, rawValue);
        });
    };

    const matchOrClauses = (row) =>
      orClauses.every((clause) =>
        String(clause)
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
          .some((c) => {
            const nullMatch = c.match(/^([a-zA-Z0-9_.]+)\.is\.null$/);
            if (nullMatch) {
              const actual = row[nullMatch[1]];
              return actual === null || actual === undefined;
            }
            const m = c.match(/^([a-zA-Z0-9_.]+)\.(eq|neq|gt|gte|lt|lte)\.(.*)$/);
            if (!m) return false;
            const [, column, operator, rawValue] = m;
            if (operator === 'eq') return rowMatches(row, column, rawValue);
            return rowMatches(row, `${operator}.${column}`, rawValue);
          })
      );

    return [...tables[table].values()].filter((row) =>
      rest.every(([column, expected]) => rowMatches(row, column, expected)) &&
      matchOr(row) && matchOrClauses(row)
    );
  };

// `rowsFor` needs the active builder state; the indirection keeps the builder
    // object small while still allowing settle() to read the pending filters.
    let state0 = { filters: {}, orClauses: [] };

    const settle = async (table, state) => {
      const op = state.write?.type ?? 'select';
      calls.push({ table, op, filters: { ...state.filters }, payload: state.write?.payload });

      // Carry `.or()` clauses (AND-ed) into the shared state so rowsFor can
      // apply them after the primary `.or()` filter.
      state0 = { filters: { ...state.filters }, orClauses: state.orClauses || [] };

    if (op === 'insert') {
      const payload = state.write.payload;
      const list = Array.isArray(payload) ? payload : [payload];
      const inserted = list.map((item) => {
        const row = {
          id: nextId(table),
          ...withDefaults(table, item),
          created_at: item.created_at || new Date().toISOString(),
        };
        tables[table].set(row.id, row);

        // Simulate database triggers
        if (table === 'messages' && !row.is_deleted) {
          // increment_unread_count trigger: increment unread for other members
          membersOf(row.conversation_id).forEach((m) => {
            if (m.profile_id !== row.sender_id && !m.left_at) {
              m.unread_count = (m.unread_count || 0) + 1;
            }
          });
          // update_conversation_last_message trigger
          const conv = tables.conversations.get(row.conversation_id);
          if (conv) {
            conv.last_message_at = row.created_at;
          }
        }

        // reset_unread_count trigger: when last_read_at changes on conversation_members
        if (table === 'conversation_members' && item.last_read_at !== undefined) {
          row.unread_count = 0;
        }

        return clone(row);
      });

      if (state.single) {
        return { data: inserted[0] ?? null, error: inserted.length ? null : MISSING_ROW, count: inserted.length };
      }
      return { data: inserted, error: null, count: inserted.length };
    }

    if (op === 'update') {
      state0 = { filters: { ...state.filters }, orClauses: state.orClauses || [] };
      const rows = rowsFor(table);
      rows.forEach((row) => {
        // reset_unread_count trigger: when last_read_at changes, reset unread_count
        if (table === 'conversation_members' && state.write.payload.last_read_at !== undefined && row.last_read_at !== state.write.payload.last_read_at) {
          Object.assign(row, clone(state.write.payload), { unread_count: 0 });
        } else {
          Object.assign(row, clone(state.write.payload));
        }
      });

      if (state.single) {
        return { data: rows[0] ? clone(rows[0]) : null, error: rows.length ? null : MISSING_ROW, count: rows.length };
      }
      return { data: rows.map(clone), error: null, count: rows.length };
    }

    if (op === 'delete') {
      state0 = { filters: { ...state.filters }, orClauses: state.orClauses || [] };
      const rows = rowsFor(table);
      rows.forEach((row) => tables[table].delete(row.id));
      return { data: rows.map(clone), error: null, count: rows.length };
    }

    // select
    state0 = { filters: { ...state.filters }, orClauses: state.orClauses || [] };
    let rows = rowsFor(table);

    if (table === 'conversations') {
      rows = rows.map(hydrateConversation);
    } else if (table === 'messages') {
      rows = rows.map(hydrateMessage);
    } else if (table === 'conversation_members') {
      rows = rows.map((row) => ({ ...clone(row) }));
    }

    if (state.order) {
      const { column, ascending, nullsFirst } = state.order;
      rows = [...rows].sort((a, b) => {
        const aNull = a[column] === null || a[column] === undefined;
        const bNull = b[column] === null || b[column] === undefined;
        if (aNull || bNull) {
          if (aNull && bNull) return 0;
          const nf = nullsFirst ?? !ascending; // default: nulls last for asc, nulls first for desc
          return aNull ? (nf ? -1 : 1) : (nf ? 1 : -1);
        }
        const left = comparable(a[column]);
        const right = comparable(b[column]);
        if (left === right) return 0;
        return ascending ? (left < right ? -1 : 1) : (left > right ? -1 : 1);
      });
    }

    if (state.range) {
      rows = rows.slice(state.range.from, state.range.to + 1);
    }
    if (state.limit !== null && state.limit !== undefined) {
      rows = rows.slice(0, state.limit);
    }

    if (state.single) {
      return { data: rows[0] ?? null, error: rows.length ? null : MISSING_ROW, count: rows.length };
    }

    return { data: rows, error: null, count: rows.length };
  };

  const makeQuery = (table) => {
    const state = {
      write: null,
      filters: {},
      orClauses: [],
      order: null,
      limit: null,
      range: null,
      single: false,
    };

    const builder = {
      select: () => builder,
      insert: (payload) => { state.write = { type: 'insert', payload }; return builder; },
      upsert: (payload) => { state.write = { type: 'insert', payload }; return builder; },
      update: (payload) => { state.write = { type: 'update', payload }; return builder; },
      delete: () => { state.write = { type: 'delete' }; return builder; },
      eq: (column, value) => { state.filters[column] = value; return builder; },
      neq: (column, value) => { state.filters[`neq.${column}`] = value; return builder; },
      gt: (column, value) => { state.filters[`gt.${column}`] = value; return builder; },
      gte: (column, value) => { state.filters[`gte.${column}`] = value; return builder; },
      lt: (column, value) => { state.filters[`lt.${column}`] = value; return builder; },
      lte: (column, value) => { state.filters[`lte.${column}`] = value; return builder; },
      is: (column, value) => { state.filters[`is.${column}`] = value; return builder; },
      in: (column, value) => { state.filters[`in.${column}`] = value; return builder; },
      // Minimal `.or("a.eq.x,b.eq.y")` support: matches rows where ANY of the
      // comma-separated `col.op.value` clauses matches. Good enough for the
      // auth lookups (email/phone) the service performs.
      or: (expression) => {
        // First `.or()` sets `__or`; subsequent ones push to `orClauses` so
        // they are AND-ed together (PostgREST chains `.or()` with AND).
        if (!state.filters.__or) {
          state.filters.__or = String(expression);
        } else {
          state.orClauses.push(String(expression));
        }
        return builder;
      },
      order: (column, options = {}) => {
        state.order = {
          column,
          ascending: options.ascending !== false,
          nullsFirst: options.nullsFirst,
        };
        return builder;
      },
      limit: (value) => { state.limit = value; return builder; },
      range: (from, to) => { state.range = { from, to }; return builder; },
      single: async () => {
        state.single = true;
        return settle(table, state);
      },
      maybeSingle: async () => {
        state.single = true;
        return settle(table, state);
      },
      then: (resolve, reject) =>
        Promise.resolve()
          .then(() => settle(table, state))
          .then(resolve, reject),
    };

    return builder;
  };

  return {
    calls,
    rpcCalls,
    from: (table) => {
      if (!tables[table]) {
        tables[table] = new Map();
      }
      return makeQuery(table);
    },
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
    // Test helpers
    dump: (table) => [...tables[table].values()].map(clone),
  };
}

export function installFakeSupabase(target, seed) {
  const original = { from: target.from, rpc: target.rpc };
  const fake = createFakeSupabase(seed);
  target.from = fake.from;
  target.rpc = fake.rpc;
  return {
    fake,
    restore: () => {
      target.from = original.from;
      target.rpc = original.rpc;
    },
  };
}