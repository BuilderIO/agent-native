import{i as e,l as t,o as n}from"./client-DU--QVjD.mjs";import{t as r}from"./migrations-TcCoYifB.mjs";function i(e,t){if(!e)return t;try{return JSON.parse(String(e))}catch{return t}}var a=[`agent_trace_spans`,`agent_trace_summaries`,`agent_satisfaction_scores`,`agent_evals`,`agent_feedback`];function o(e,t,n){return n==null?{where:e,args:t}:{where:`${e} AND user_id = ?`,args:[...t,n]}}var s;async function c(){return s||=(async()=>{let t=e();await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_trace_spans (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          user_id TEXT,
          parent_span_id TEXT,
          span_type TEXT NOT NULL,
          name TEXT NOT NULL,
          input_tokens ${n()} NOT NULL DEFAULT 0,
          output_tokens ${n()} NOT NULL DEFAULT 0,
          cache_read_tokens ${n()} NOT NULL DEFAULT 0,
          cache_write_tokens ${n()} NOT NULL DEFAULT 0,
          cost_cents_x100 ${n()} NOT NULL DEFAULT 0,
          duration_ms ${n()} NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'success',
          error_message TEXT,
          metadata TEXT,
          created_at ${n()} NOT NULL
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_trace_summaries (
          run_id TEXT PRIMARY KEY,
          thread_id TEXT,
          user_id TEXT,
          total_spans ${n()} NOT NULL DEFAULT 0,
          llm_calls ${n()} NOT NULL DEFAULT 0,
          tool_calls ${n()} NOT NULL DEFAULT 0,
          successful_tools ${n()} NOT NULL DEFAULT 0,
          failed_tools ${n()} NOT NULL DEFAULT 0,
          total_duration_ms ${n()} NOT NULL DEFAULT 0,
          total_cost_cents_x100 ${n()} NOT NULL DEFAULT 0,
          total_input_tokens ${n()} NOT NULL DEFAULT 0,
          total_output_tokens ${n()} NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          created_at ${n()} NOT NULL
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_feedback (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          thread_id TEXT,
          message_seq ${n()},
          feedback_type TEXT NOT NULL,
          value TEXT NOT NULL DEFAULT '',
          user_id TEXT,
          created_at ${n()} NOT NULL
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_satisfaction_scores (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          user_id TEXT,
          frustration_score REAL NOT NULL DEFAULT 0,
          rephrasing_score REAL NOT NULL DEFAULT 0,
          abandonment_score REAL NOT NULL DEFAULT 0,
          sentiment_score REAL NOT NULL DEFAULT 0,
          length_trend_score REAL NOT NULL DEFAULT 0,
          computed_at ${n()} NOT NULL
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_evals (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          thread_id TEXT,
          user_id TEXT,
          eval_type TEXT NOT NULL,
          criteria TEXT NOT NULL,
          score REAL NOT NULL DEFAULT 0,
          reasoning TEXT,
          metadata TEXT,
          created_at ${n()} NOT NULL
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_eval_datasets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          entries TEXT NOT NULL DEFAULT '[]',
          created_at ${n()} NOT NULL,
          updated_at ${n()} NOT NULL
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_experiments (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          variants TEXT NOT NULL DEFAULT '[]',
          metrics TEXT NOT NULL DEFAULT '[]',
          assignment_level TEXT NOT NULL DEFAULT 'user',
          started_at ${n()},
          ended_at ${n()},
          created_at ${n()} NOT NULL,
          owner_email TEXT
        )
      `);try{await t.execute(`ALTER TABLE agent_experiments ADD COLUMN owner_email TEXT`)}catch{}await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_experiment_assignments (
          experiment_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          assigned_at ${n()} NOT NULL,
          PRIMARY KEY (experiment_id, user_id)
        )
      `),await t.execute(`
        CREATE TABLE IF NOT EXISTS agent_experiment_results (
          id TEXT PRIMARY KEY,
          experiment_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL DEFAULT 0,
          sample_size ${n()} NOT NULL DEFAULT 0,
          confidence_low REAL NOT NULL DEFAULT 0,
          confidence_high REAL NOT NULL DEFAULT 0,
          computed_at ${n()} NOT NULL
        )
      `);for(let e of a)try{await t.execute(`ALTER TABLE ${e} ADD COLUMN user_id TEXT`)}catch(e){if(r(e))continue;throw e}for(let e of[`CREATE INDEX IF NOT EXISTS idx_trace_spans_run ON agent_trace_spans (run_id)`,`CREATE INDEX IF NOT EXISTS idx_trace_spans_thread ON agent_trace_spans (thread_id)`,`CREATE INDEX IF NOT EXISTS idx_trace_spans_created ON agent_trace_spans (created_at)`,`CREATE INDEX IF NOT EXISTS idx_trace_summaries_created ON agent_trace_summaries (created_at)`,`CREATE INDEX IF NOT EXISTS idx_trace_summaries_user ON agent_trace_summaries (user_id, created_at)`,`CREATE INDEX IF NOT EXISTS idx_trace_spans_user ON agent_trace_spans (user_id)`,`CREATE INDEX IF NOT EXISTS idx_feedback_thread ON agent_feedback (thread_id)`,`CREATE INDEX IF NOT EXISTS idx_feedback_created ON agent_feedback (created_at)`,`CREATE INDEX IF NOT EXISTS idx_feedback_user ON agent_feedback (user_id, created_at)`,`CREATE INDEX IF NOT EXISTS idx_satisfaction_thread ON agent_satisfaction_scores (thread_id)`,`CREATE INDEX IF NOT EXISTS idx_satisfaction_user ON agent_satisfaction_scores (user_id, computed_at)`,`CREATE INDEX IF NOT EXISTS idx_evals_run ON agent_evals (run_id)`,`CREATE INDEX IF NOT EXISTS idx_evals_created ON agent_evals (created_at)`,`CREATE INDEX IF NOT EXISTS idx_evals_user ON agent_evals (user_id, created_at)`,`CREATE INDEX IF NOT EXISTS idx_experiment_results_exp ON agent_experiment_results (experiment_id)`])try{await t.execute(e)}catch{}})().catch(e=>{throw s=void 0,e}),s}async function l(t){await c(),await e().execute({sql:`INSERT INTO agent_trace_spans
      (id, run_id, thread_id, user_id, parent_span_id, span_type, name,
       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       cost_cents_x100, duration_ms, status, error_message, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,args:[t.id,t.runId,t.threadId,t.userId,t.parentSpanId,t.spanType,t.name,t.inputTokens,t.outputTokens,t.cacheReadTokens,t.cacheWriteTokens,t.costCentsX100,t.durationMs,t.status,t.errorMessage,t.metadata?JSON.stringify(t.metadata):null,t.createdAt]})}async function u(n){await c();let r=e();t(),await r.execute({sql:`INSERT INTO agent_trace_summaries
        (run_id, thread_id, user_id, total_spans, llm_calls, tool_calls,
         successful_tools, failed_tools, total_duration_ms,
         total_cost_cents_x100, total_input_tokens, total_output_tokens,
         model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id) DO UPDATE SET
          total_spans = EXCLUDED.total_spans,
          llm_calls = EXCLUDED.llm_calls,
          tool_calls = EXCLUDED.tool_calls,
          successful_tools = EXCLUDED.successful_tools,
          failed_tools = EXCLUDED.failed_tools,
          total_duration_ms = EXCLUDED.total_duration_ms,
          total_cost_cents_x100 = EXCLUDED.total_cost_cents_x100,
          total_input_tokens = EXCLUDED.total_input_tokens,
          total_output_tokens = EXCLUDED.total_output_tokens,
          model = EXCLUDED.model`,args:[n.runId,n.threadId,n.userId,n.totalSpans,n.llmCalls,n.toolCalls,n.successfulTools,n.failedTools,n.totalDurationMs,n.totalCostCentsX100,n.totalInputTokens,n.totalOutputTokens,n.model,n.createdAt]})}async function d(t,n={}){await c();let r=e(),{where:i,args:a}=o(`run_id = ?`,[t],n.userId),{rows:s}=await r.execute({sql:`SELECT * FROM agent_trace_spans WHERE ${i} ORDER BY created_at ASC`,args:a});return s.map(j)}async function f(t){await c();let n=e(),r=t.sinceMs??0,i=t.limit??100,{where:a,args:s}=o(`created_at >= ?`,[r],t.userId),{rows:l}=await n.execute({sql:`SELECT * FROM agent_trace_summaries
      WHERE ${a}
      ORDER BY created_at DESC
      LIMIT ?`,args:[...s,i]});return l.map(M)}async function p(t,n={}){await c();let r=e(),{where:i,args:a}=o(`run_id = ?`,[t],n.userId),{rows:s}=await r.execute({sql:`SELECT * FROM agent_trace_summaries WHERE ${i}`,args:a});return s.length===0?null:M(s[0])}async function m(t){await c(),await e().execute({sql:`INSERT INTO agent_feedback
      (id, run_id, thread_id, message_seq, feedback_type, value, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,args:[t.id,t.runId,t.threadId,t.messageSeq,t.feedbackType,t.value,t.userId,t.createdAt]})}async function h(t){await c();let n=e(),r=[],i=[];t.threadId&&(r.push(`thread_id = ?`),i.push(t.threadId)),t.sinceMs&&(r.push(`created_at >= ?`),i.push(t.sinceMs)),t.feedbackType&&(r.push(`feedback_type = ?`),i.push(t.feedbackType)),t.userId&&(r.push(`user_id = ?`),i.push(t.userId));let a=r.length>0?`WHERE ${r.join(` AND `)}`:``,o=t.limit??100,{rows:s}=await n.execute({sql:`SELECT * FROM agent_feedback ${a} ORDER BY created_at DESC LIMIT ?`,args:[...i,o]});return s.map(N)}async function g(t,n={}){await c();let r=e(),{where:i,args:a}=o(`created_at >= ?`,[t],n.userId),{rows:s}=await r.execute({sql:`SELECT feedback_type, value, COUNT(*) as cnt
      FROM agent_feedback WHERE ${i}
      GROUP BY feedback_type, value`,args:a}),l=0,u=0,d=0,f={};for(let e of s){let t=Number(e.cnt);l+=t,e.feedback_type===`thumbs_up`?u+=t:e.feedback_type===`thumbs_down`?d+=t:e.feedback_type===`category`&&(f[String(e.value)]=t)}return{total:l,thumbsUp:u,thumbsDown:d,categories:f}}async function _(n){await c();let r=e();t(),await r.execute({sql:`INSERT INTO agent_satisfaction_scores
        (id, thread_id, user_id, frustration_score, rephrasing_score,
         abandonment_score, sentiment_score, length_trend_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          frustration_score = EXCLUDED.frustration_score,
          rephrasing_score = EXCLUDED.rephrasing_score,
          abandonment_score = EXCLUDED.abandonment_score,
          sentiment_score = EXCLUDED.sentiment_score,
          length_trend_score = EXCLUDED.length_trend_score,
          computed_at = EXCLUDED.computed_at`,args:[n.id,n.threadId,n.userId,n.frustrationScore,n.rephrasingScore,n.abandonmentScore,n.sentimentScore,n.lengthTrendScore,n.computedAt]})}async function v(t){await c();let n=e(),r=[],i=[];t.sinceMs&&(r.push(`computed_at >= ?`),i.push(t.sinceMs)),t.minFrustration!=null&&(r.push(`frustration_score >= ?`),i.push(t.minFrustration)),t.userId&&(r.push(`user_id = ?`),i.push(t.userId));let a=r.length>0?`WHERE ${r.join(` AND `)}`:``,{rows:o}=await n.execute({sql:`SELECT * FROM agent_satisfaction_scores ${a}
      ORDER BY computed_at DESC LIMIT ?`,args:[...i,t.limit??100]});return o.map(P)}async function y(t){await c(),await e().execute({sql:`INSERT INTO agent_evals
      (id, run_id, thread_id, user_id, eval_type, criteria, score, reasoning, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,args:[t.id,t.runId,t.threadId,t.userId,t.evalType,t.criteria,t.score,t.reasoning,t.metadata?JSON.stringify(t.metadata):null,t.createdAt]})}async function b(t,n={}){await c();let r=e(),{where:i,args:a}=o(`run_id = ?`,[t],n.userId),{rows:s}=await r.execute({sql:`SELECT * FROM agent_evals WHERE ${i} ORDER BY created_at ASC`,args:a});return s.map(F)}async function x(t,n={}){await c();let r=e(),{where:i,args:a}=o(`created_at >= ?`,[t],n.userId),{rows:s}=await r.execute({sql:`SELECT COUNT(*) as cnt, AVG(score) as avg_score
      FROM agent_evals WHERE ${i}`,args:a}),l=s[0]??{},{rows:u}=await r.execute({sql:`SELECT criteria, AVG(score) as avg_score, COUNT(*) as cnt
      FROM agent_evals WHERE ${i}
      GROUP BY criteria ORDER BY cnt DESC`,args:a});return{totalEvals:Number(l.cnt??0),avgScore:Number(l.avg_score??0),byCriteria:u.map(e=>({criteria:String(e.criteria),avgScore:Number(e.avg_score??0),count:Number(e.cnt??0)}))}}async function S(t){await c(),await e().execute({sql:`INSERT INTO agent_experiments
      (id, name, status, variants, metrics, assignment_level,
       started_at, ended_at, created_at, owner_email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,args:[t.id,t.name,t.status,JSON.stringify(t.variants),JSON.stringify(t.metrics),t.assignmentLevel,t.startedAt,t.endedAt,t.createdAt,t.ownerEmail??null]})}async function C(t,n){await c();let r=e(),i=[],a=[];n.name!==void 0&&(i.push(`name = ?`),a.push(n.name)),n.status!==void 0&&(i.push(`status = ?`),a.push(n.status),n.status===`running`&&!n.endedAt&&(i.push(`started_at = ?`),a.push(Date.now()))),n.variants!==void 0&&(i.push(`variants = ?`),a.push(JSON.stringify(n.variants))),n.metrics!==void 0&&(i.push(`metrics = ?`),a.push(JSON.stringify(n.metrics))),n.endedAt!==void 0&&(i.push(`ended_at = ?`),a.push(n.endedAt)),i.length!==0&&(a.push(t),await r.execute({sql:`UPDATE agent_experiments SET ${i.join(`, `)} WHERE id = ?`,args:a}))}async function w(){await c();let{rows:t}=await e().execute(`SELECT * FROM agent_experiments ORDER BY created_at DESC`);return t.map(I)}async function T(t){await c();let{rows:n}=await e().execute({sql:`SELECT * FROM agent_experiments WHERE id = ?`,args:[t]});return n.length===0?null:I(n[0])}async function E(n){await c();let r=e();t()?await r.execute({sql:`INSERT INTO agent_experiment_assignments
        (experiment_id, user_id, variant_id, assigned_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (experiment_id, user_id) DO UPDATE SET
          variant_id = EXCLUDED.variant_id,
          assigned_at = EXCLUDED.assigned_at`,args:[n.experimentId,n.userId,n.variantId,n.assignedAt]}):await r.execute({sql:`INSERT OR REPLACE INTO agent_experiment_assignments
        (experiment_id, user_id, variant_id, assigned_at)
        VALUES (?, ?, ?, ?)`,args:[n.experimentId,n.userId,n.variantId,n.assignedAt]})}async function D(t,n){await c();let{rows:r}=await e().execute({sql:`SELECT * FROM agent_experiment_assignments
      WHERE experiment_id = ? AND user_id = ?`,args:[t,n]});if(r.length===0)return null;let i=r[0];return{experimentId:i.experiment_id,userId:i.user_id,variantId:i.variant_id,assignedAt:Number(i.assigned_at)}}async function O(t){await c(),await e().execute({sql:`INSERT INTO agent_experiment_results
      (id, experiment_id, variant_id, metric, value,
       sample_size, confidence_low, confidence_high, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,args:[t.id,t.experimentId,t.variantId,t.metric,t.value,t.sampleSize,t.confidenceLow,t.confidenceHigh,t.computedAt]})}async function k(t){await c();let{rows:n}=await e().execute({sql:`SELECT * FROM agent_experiment_results
      WHERE experiment_id = ?
      ORDER BY computed_at DESC`,args:[t]});return n.map(L)}async function A(t,n={}){await c();let r=e(),i=o(`created_at >= ?`,[t],n.userId),a=o(`computed_at >= ?`,[t],n.userId),[s,l,u,d]=await Promise.all([r.execute({sql:`SELECT
          COUNT(*) as total_runs,
          COALESCE(SUM(total_cost_cents_x100), 0) as total_cost,
          COALESCE(AVG(total_duration_ms), 0) as avg_duration,
          COALESCE(SUM(successful_tools), 0) as success_tools,
          COALESCE(SUM(tool_calls), 0) as total_tools
          FROM agent_trace_summaries WHERE ${i.where}`,args:i.args}),r.execute({sql:`SELECT COALESCE(AVG(frustration_score), 0) as avg_frustration
          FROM agent_satisfaction_scores WHERE ${a.where}`,args:a.args}),r.execute({sql:`SELECT
          COALESCE(SUM(CASE WHEN feedback_type = 'thumbs_up' THEN 1 ELSE 0 END), 0) as up,
          COALESCE(SUM(CASE WHEN feedback_type IN ('thumbs_up', 'thumbs_down') THEN 1 ELSE 0 END), 0) as total
          FROM agent_feedback WHERE ${i.where}`,args:i.args}),r.execute({sql:`SELECT COALESCE(AVG(score), 0) as avg_score
          FROM agent_evals WHERE ${i.where}`,args:i.args})]),f=s.rows[0]??{},p=l.rows[0]??{},m=u.rows[0]??{},h=d.rows[0]??{},g=Number(f.total_tools??0),_=Number(f.success_tools??0),v=Number(m.total??0),y=Number(m.up??0);return{totalRuns:Number(f.total_runs??0),totalCostCents:Number(f.total_cost??0)/100,avgDurationMs:Number(f.avg_duration??0),toolSuccessRate:g>0?_/g:1,avgFrustrationScore:Number(p.avg_frustration??0),thumbsUpRate:v>0?y/v:0,avgEvalScore:Number(h.avg_score??0)}}function j(e){return{id:String(e.id),runId:String(e.run_id),threadId:e.thread_id?String(e.thread_id):null,userId:e.user_id?String(e.user_id):null,parentSpanId:e.parent_span_id?String(e.parent_span_id):null,spanType:e.span_type,name:String(e.name),inputTokens:Number(e.input_tokens??0),outputTokens:Number(e.output_tokens??0),cacheReadTokens:Number(e.cache_read_tokens??0),cacheWriteTokens:Number(e.cache_write_tokens??0),costCentsX100:Number(e.cost_cents_x100??0),durationMs:Number(e.duration_ms??0),status:e.status,errorMessage:e.error_message?String(e.error_message):null,metadata:i(e.metadata,null),createdAt:Number(e.created_at)}}function M(e){return{runId:String(e.run_id),threadId:e.thread_id?String(e.thread_id):null,userId:e.user_id?String(e.user_id):null,totalSpans:Number(e.total_spans??0),llmCalls:Number(e.llm_calls??0),toolCalls:Number(e.tool_calls??0),successfulTools:Number(e.successful_tools??0),failedTools:Number(e.failed_tools??0),totalDurationMs:Number(e.total_duration_ms??0),totalCostCentsX100:Number(e.total_cost_cents_x100??0),totalInputTokens:Number(e.total_input_tokens??0),totalOutputTokens:Number(e.total_output_tokens??0),model:String(e.model??``),createdAt:Number(e.created_at)}}function N(e){return{id:String(e.id),runId:e.run_id?String(e.run_id):null,threadId:e.thread_id?String(e.thread_id):null,messageSeq:e.message_seq==null?null:Number(e.message_seq),feedbackType:e.feedback_type,value:String(e.value??``),userId:e.user_id?String(e.user_id):null,createdAt:Number(e.created_at)}}function P(e){return{id:String(e.id),threadId:String(e.thread_id),userId:e.user_id?String(e.user_id):null,frustrationScore:Number(e.frustration_score??0),rephrasingScore:Number(e.rephrasing_score??0),abandonmentScore:Number(e.abandonment_score??0),sentimentScore:Number(e.sentiment_score??0),lengthTrendScore:Number(e.length_trend_score??0),computedAt:Number(e.computed_at)}}function F(e){return{id:String(e.id),runId:String(e.run_id),threadId:e.thread_id?String(e.thread_id):null,userId:e.user_id?String(e.user_id):null,evalType:e.eval_type,criteria:String(e.criteria),score:Number(e.score??0),reasoning:e.reasoning?String(e.reasoning):null,metadata:i(e.metadata,null),createdAt:Number(e.created_at)}}function I(e){return{id:String(e.id),name:String(e.name),status:e.status,variants:i(e.variants,[]),metrics:i(e.metrics,[]),assignmentLevel:e.assignment_level??`user`,startedAt:e.started_at?Number(e.started_at):null,endedAt:e.ended_at?Number(e.ended_at):null,createdAt:Number(e.created_at),ownerEmail:typeof e.owner_email==`string`&&e.owner_email?e.owner_email:null}}function L(e){return{id:String(e.id),experimentId:String(e.experiment_id),variantId:String(e.variant_id),metric:String(e.metric),value:Number(e.value??0),sampleSize:Number(e.sample_size??0),confidenceLow:Number(e.confidence_low??0),confidenceHigh:Number(e.confidence_high??0),computedAt:Number(e.computed_at)}}export{c as ensureObservabilityTables,D as getAssignment,x as getEvalStats,b as getEvalsForRun,T as getExperiment,k as getExperimentResults,h as getFeedback,g as getFeedbackStats,A as getObservabilityOverview,v as getSatisfactionScores,d as getTraceSpansForRun,f as getTraceSummaries,p as getTraceSummary,y as insertEvalResult,S as insertExperiment,O as insertExperimentResult,m as insertFeedback,l as insertTraceSpan,w as listExperiments,C as updateExperiment,E as upsertAssignment,_ as upsertSatisfactionScore,u as upsertTraceSummary};