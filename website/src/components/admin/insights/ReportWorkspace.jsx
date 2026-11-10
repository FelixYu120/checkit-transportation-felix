import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Database, ClipboardCheck, MessageSquare, ListTodo, RefreshCw, X } from 'lucide-react';
import { REPORT_METRICS, compareReportVersions, getReportEvidence, loadReportVersion,
  loadReportWorkspace, runReportCommand, workflowErrorMessage } from './ReportEnterprise.js';
import styles from './ReportWorkspace.module.css';

const formatDate = (value, timezone) => value ? new Date(value).toLocaleString(undefined, timezone ? { timeZone: timezone } : {}) : 'Not recorded';
const statusLabel = value => ({ draft: 'Draft', in_review: 'In review', reviewed: 'Reviewed', published: 'Published', changes_requested: 'Changes requested', superseded: 'Superseded' }[value] || 'Draft');
const number = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const WORKSPACE_TABS = [
  { key: 'overview', label: 'Data', hint: 'Data sources and purpose', icon: Database },
  { key: 'review', label: 'Review', hint: 'Review and version history', icon: ClipboardCheck },
  { key: 'discussion', label: 'Comments', hint: 'Comments and discussion', icon: MessageSquare },
  { key: 'actions', label: 'Actions', hint: 'Follow-up actions', icon: ListTodo },
];

export function ReportDataNotes({ elements, product, decisionQuestion, metricDefinitions, expandedDefinitions = false }) {
  const evidence = getReportEvidence(elements);
  return <div className={styles.dataNotes}>
    <h3>Data sources &amp; definitions</h3>
    {decisionQuestion && <p><strong>Decision question:</strong> {decisionQuestion}</p>}
    {evidence.length === 0 && <p>No charts have been added.</p>}
    {evidence.map(chart => <div key={chart.id} className={styles.sourceNote}>
      <strong>{chart.title} · {chart.id}{chart.evidence?.isDemo ? ' · Demo data' : ''}</strong>
      {chart.evidence ? <>
        <p>Source: {chart.evidence.sources?.join(', ') || 'Not recorded'} · Timezone: {chart.evidence.timezone || 'Not recorded'}</p>
        <p>Observed: {formatDate(chart.evidence.firstObservedAt, chart.evidence.timezone)} – {formatDate(chart.evidence.lastObservedAt, chart.evidence.timezone)}</p>
        <p>Captured: {formatDate(chart.evidence.generatedAt)} · {chart.evidence.sourceRows ?? 'Unknown'} input rows after filtering / aggregation</p>
        <p>{chart.evidence.observedBuckets ?? 'Unknown'} displayed buckets with data · {chart.evidence.missingBuckets == null ? 'Missing-bucket count unavailable' : `${chart.evidence.missingBuckets} displayed buckets without data`}</p>
        <p>Window: {chart.evidence.timeframe || 'Not recorded'}{chart.evidence.filters?.startDate ? ` · ${chart.evidence.filters.startDate} to ${chart.evidence.filters.endDate || chart.evidence.filters.startDate}` : ' · relative reporting window'} · {chart.evidence.filters?.startTime || '00:00'}–{chart.evidence.filters?.endTime || '23:59'} · {chart.evidence.filters?.dayPreset || 'all'} days</p>
      </> : <p>Source details were not saved with this chart. Refresh its data and save the report.</p>}
    </div>)}
    <p>Missing observations do not mean zero activity. Displayed bucket availability is not a measure of sensor uptime. Daily summaries cannot establish coverage within a day.</p>
    <details open={expandedDefinitions}><summary>Metric definitions and units</summary><dl>{(metricDefinitions || REPORT_METRICS[product] || []).map(([key, label, unit, description]) => <div key={key}><dt>{label} ({unit})</dt><dd>{description}</dd></div>)}</dl></details>
  </div>;
}

const VersionSelect = ({ versions, value, onChange, label, optional = true }) => <label>{label}
  <select value={value || ''} onChange={event => onChange(event.target.value)}>
    <option value="">{optional ? 'None selected' : 'Choose a version'}</option>
    {versions.map(version => <option key={version.id} value={version.id}>v{version.version_number} · {statusLabel(version.status)}</option>)}
  </select>
</label>;

function ActionItem({ action, members, versions, disabled, onUpdate, onCompare }) {
  const [status, setStatus] = useState(action.status);
  const [outcome, setOutcome] = useState(action.outcome || '');
  const [followup, setFollowup] = useState(action.followup_version_id || '');
  const assignee = members.find(member => member.id === action.assigned_to);
  return <article className={styles.item}>
    <h3>{action.title}</h3>
    <p>{assignee?.label || 'Team member'} · Due {action.due_date}{action.intervention_date ? ` · Change made ${action.intervention_date}` : ''}</p>
    <div className={styles.fields}><label>Status<select disabled={disabled} value={status} onChange={event => setStatus(event.target.value)}>
      <option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option>
    </select></label>
    <VersionSelect versions={versions} label="Follow-up version" value={followup} onChange={setFollowup} />
    </div>
    <label>Outcome or finding<textarea disabled={disabled} maxLength={5000} value={outcome} onChange={event => setOutcome(event.target.value)} placeholder="What happened, and what evidence supports it?" /></label>
    <div className={styles.buttons}>
      {!disabled && <button type="button" disabled={status === 'done' && outcome.trim().length < 5} onClick={() => onUpdate({ id: action.id, status, outcome, followup_version_id: followup || null })}>Save action</button>}
      {action.baseline_version_id && followup && <button type="button" onClick={() => onCompare(action.baseline_version_id, followup)}>Compare results</button>}
    </div>
  </article>;
}

export default function ReportWorkspace({ client, reportId, product, elements, decisionQuestion, metricDefinitions, onDecisionChange, initialTab = 'overview',
  onSave, onRefreshData, onOpenVersion, onRestore, readOnly, documentReadOnly = false, currentVersionId, onClose }) {
  const [tab, setTab] = useState(() => WORKSPACE_TABS.some(item => item.key === initialTab) ? initialTab : 'overview');
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [reviewer, setReviewer] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [comment, setComment] = useState('');
  const [commentVersion, setCommentVersion] = useState('');
  const [commentElement, setCommentElement] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [interventionDate, setInterventionDate] = useState('');
  const [baseline, setBaseline] = useState('');
  const [comparison, setComparison] = useState(null);
  const [restoreVersion, setRestoreVersion] = useState(null);
  const dialog = useRef(null);
  const loadSequence = useRef(0);
  const operationPending = useRef(false);
  const versions = workspace?.versions || [];
  const members = workspace?.members || [];
  const canEdit = Boolean(workspace?.can_edit) && !readOnly;
  const activeVersion = versions.find(version => version.id === workspace?.workflow?.active_version_id);
  const status = workspace?.workflow?.status || 'draft';

  useEffect(() => {
    let active = true;
    const sequence = ++loadSequence.current;
    const load = async () => {
      setWorkspace(null); setError('');
      if (!reportId) return;
      setLoading(true);
      try {
        const data = await loadReportWorkspace(client, reportId);
        if (active && sequence === loadSequence.current) setWorkspace(data);
      } catch (failure) { if (active) setError(workflowErrorMessage(failure)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [client, reportId, reload]);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('button:not(:disabled)')?.focus();
    const handleKey = event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(dialog.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary') || [])].filter(node => node.tabIndex >= 0 && node.getClientRects().length);
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus(); };
  }, [busy, onClose]);

  const command = async (name, payload) => {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const id = name === 'submit' ? await onSave() : reportId;
      if (!id) throw new Error('Save the report before continuing.');
      await runReportCommand(client, id, name, payload);
      if (name === 'comment') setComment('');
      if (name === 'add_action') { setActionTitle(''); setDueDate(''); }
      setNotice(name === 'publish' ? 'Published. This version keeps its reviewed data.' : 'Updated.');
      setReload(value => value + 1);
    } catch (failure) { setError(workflowErrorMessage(failure)); }
    finally { operationPending.current = false; setBusy(false); }
  };

  const compare = async (before, after) => {
    if (before === after) { setError('Choose different baseline and follow-up versions.'); return; }
    setBusy(true); setError('');
    try {
      const pair = await Promise.all([loadReportVersion(client, reportId, before), loadReportVersion(client, reportId, after)]);
      setComparison(compareReportVersions(...pair, product));
    } catch (failure) { setError(workflowErrorMessage(failure)); }
    finally { setBusy(false); }
  };

  return createPortal(<div className={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="report-workspace-title" aria-busy={busy}>
      <header><div><h2 id="report-workspace-title">Report details</h2><p>{statusLabel(status)}{workspace?.workflow?.published_version_id && status !== 'published' ? ' · Published version available' : ''}</p></div>
        <div className={styles.headerActions}>
          <span className={styles.iconHint} data-tooltip="Refresh details"><button type="button" className={styles.headerIcon} aria-label="Refresh details" onClick={() => setReload(value => value + 1)} disabled={busy || !reportId}><RefreshCw size={18} aria-hidden="true" /></button></span>
          <span className={styles.iconHint} data-tooltip="Close"><button type="button" className={styles.headerIcon} aria-label="Close" onClick={onClose} disabled={busy}><X size={18} aria-hidden="true" /></button></span>
        </div></header>
      <div className={styles.workspaceTabs} role="tablist" aria-label="Report details sections" onKeyDown={event => {
        const selectedIndex = WORKSPACE_TABS.findIndex(item => item.key === tab);
        const nextIndex = event.key === 'ArrowRight' ? (selectedIndex + 1) % WORKSPACE_TABS.length
          : event.key === 'ArrowLeft' ? (selectedIndex + WORKSPACE_TABS.length - 1) % WORKSPACE_TABS.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACE_TABS.length - 1 : null;
        if (nextIndex == null) return;
        event.preventDefault();
        setTab(WORKSPACE_TABS[nextIndex].key);
        event.currentTarget.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
      }}>
        {WORKSPACE_TABS.map(({ key, label, hint, icon: Icon }) => <button type="button" key={key}
          id={`report-details-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`report-details-panel-${key}`}
          tabIndex={tab === key ? 0 : -1} title={hint} onClick={() => setTab(key)}>
          {React.createElement(Icon, { size: 18, 'aria-hidden': true })}<span>{label}</span>
        </button>)}
      </div>
      <div className={styles.body} id={`report-details-panel-${tab}`} role="tabpanel" aria-labelledby={`report-details-tab-${tab}`}><fieldset className={styles.controls} disabled={busy}>
        {loading && <p role="status">Loading report details…</p>}
        {error && <div className={styles.error} role="alert"><p>{error}</p>{!busy && reportId && <button type="button" onClick={() => setReload(value => value + 1)}>Try again</button>}</div>}
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
        {!reportId && <div className={styles.item}><p>{tab === 'discussion' ? 'Save this report to add comments and discuss it with your team.' : 'Save this report to start a review, add comments, and assign follow-up actions.'}</p><button type="button" disabled={busy || readOnly} onClick={onSave}>Save report</button></div>}
        {tab === 'overview' && <>
          <label>Decision question<textarea value={decisionQuestion || ''} disabled={readOnly || documentReadOnly} onChange={event => onDecisionChange(event.target.value)} maxLength={500} placeholder="What decision should this report help your team make?" /></label>
          <ReportDataNotes elements={elements} product={product} decisionQuestion={decisionQuestion} metricDefinitions={metricDefinitions} />
          {!readOnly && !documentReadOnly && <div className={styles.buttons}><button type="button" onClick={onRefreshData}>Refresh chart data</button></div>}
        </>}
        {tab === 'review' && workspace && <>
          <p>Submit a saved version to a different editor for review. Only the owner can publish an approved version. Editing the report returns its working copy to Draft.</p>
          {canEdit && !documentReadOnly && !['in_review','reviewed'].includes(status) && <div className={styles.item}>
            <label>Reviewer<select value={reviewer} onChange={event => setReviewer(event.target.value)}><option value="">Choose a report editor</option>{members.filter(member => member.id !== workspace.user_id).map(member => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label>
            {members.filter(member => member.id !== workspace.user_id).length === 0 && <p>Share this report with another editor before requesting a review.</p>}
            <button type="button" disabled={busy || !reviewer} onClick={() => command('submit', { reviewer_id: reviewer })}>Save and request review</button>
          </div>}
          {canEdit && status === 'in_review' && activeVersion?.reviewer_id === workspace.user_id && <div className={styles.item}>
            <p>Review version {activeVersion.version_number} and its data notes before approving.</p>
            <button type="button" onClick={() => onOpenVersion(activeVersion.id)}>Open version for review</button>
            <label>Review note<textarea maxLength={5000} value={reviewNote} onChange={event => setReviewNote(event.target.value)} /></label>
            <div className={styles.buttons}><button type="button" disabled={busy || currentVersionId !== activeVersion.id} onClick={() => command('approve', { note: reviewNote })}>Approve version</button>
              <button type="button" disabled={busy || currentVersionId !== activeVersion.id || reviewNote.trim().length < 5} onClick={() => command('request_changes', { note: reviewNote })}>Request changes</button></div>
          </div>}
          {canEdit && workspace.is_owner && status === 'reviewed' && <button type="button" className={styles.primary} disabled={busy} onClick={() => command('publish', {})}>Publish reviewed version</button>}
          <h3>Saved versions</h3>{versions.length === 0 && <p>No version has been submitted for review yet.</p>}
          {versions.map(version => <article className={styles.item} key={version.id}>
            <strong>Version {version.version_number} · {statusLabel(version.status)}</strong><p>{version.status === 'draft' ? 'Saved' : 'Submitted'} {formatDate(version.submitted_at)}{version.published_at ? ` · Published ${formatDate(version.published_at)}` : ''}</p>
            {version.review_note && <p>{version.review_note}</p>}
            <div className={styles.buttons}><button type="button" onClick={() => onOpenVersion(version.id)}>Open saved version</button>{canEdit && <button type="button" disabled={busy} onClick={() => setRestoreVersion(version)}>Restore as draft</button>}</div>
          </article>)}
          {restoreVersion && <div className={styles.item} role="alert"><p>Replace the working draft with version {restoreVersion.version_number}? Saved versions and current sharing will be preserved.</p><div className={styles.buttons}><button type="button" onClick={() => setRestoreVersion(null)}>Cancel restore</button><button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onRestore(restoreVersion.id); setRestoreVersion(null); } catch (failure) { setError(workflowErrorMessage(failure)); } finally { setBusy(false); } }}>Restore draft</button></div></div>}
          <details><summary>Activity history</summary>{(workspace.events || []).map(event => <p key={event.id}>{event.actor_label} · {event.event.replaceAll('_',' ')} · {formatDate(event.created_at)}</p>)}</details>
        </>}
        {tab === 'discussion' && <h3>Comments</h3>}
        {tab === 'discussion' && workspace && <>
          {!canEdit && <p>Comments are read-only for your account. Ask the owner for editor access to post.</p>}
          {canEdit && <form onSubmit={event => { event.preventDefault(); void command('comment', { body: comment, version_id: commentVersion || null, element_id: commentElement || null }); }}>
            <VersionSelect versions={versions} value={commentVersion} onChange={setCommentVersion} label="Attach to a version" />
            <label>Chart or note<select value={commentElement} onChange={event => setCommentElement(event.target.value)}><option value="">Whole report</option>{elements.map(element => <option key={element.id} value={element.id}>{element.title || element.type} · {element.id}</option>)}</select></label>
            <label>Comment<textarea required maxLength={5000} value={comment} onChange={event => setComment(event.target.value)} /></label><button disabled={busy || !comment.trim()} type="submit">Add comment</button>
          </form>}
          {(workspace.comments || []).length === 0 && <p>No comments yet.</p>}
          {(workspace.comments || []).map(item => <article key={item.id} className={styles.item}><strong>{item.author_label}</strong><p>{item.body}</p><small>{formatDate(item.created_at)}{item.element_id ? ` · ${item.element_id}` : ''}{item.version_id ? ` · v${versions.find(version => version.id === item.version_id)?.version_number || '?'}` : ' · Working report'}</small></article>)}
        </>}
        {tab === 'actions' && workspace && <>
          {canEdit && <details><summary>Assign a follow-up</summary><form onSubmit={event => { event.preventDefault(); void command('add_action', { title: actionTitle, assigned_to: assignee, due_date: dueDate, intervention_date: interventionDate || null, baseline_version_id: baseline || null }); }}>
            <label>Action<input required maxLength={240} value={actionTitle} onChange={event => setActionTitle(event.target.value)} placeholder="What should the team do?" /></label>
            <div className={styles.fields}><label>Owner<select required value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">Choose an editor</option>{members.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}</select></label><label>Due date<input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label></div>
            <label>Intervention date (optional)<input type="date" value={interventionDate} onChange={event => setInterventionDate(event.target.value)} /></label>
            <VersionSelect versions={versions} value={baseline} onChange={setBaseline} label="Baseline version" />
            <button type="submit" disabled={busy || !actionTitle.trim() || !assignee || !dueDate}>Create action</button>
          </form></details>}
          {(workspace.actions || []).length === 0 && <p>No follow-up actions yet. Attach a baseline version, make a change, then link a later report version to evaluate it.</p>}
          {(workspace.actions || []).map(action => <ActionItem key={`${action.id}-${action.updated_at}`} action={action} members={members} versions={versions} disabled={busy || !canEdit} onUpdate={payload => command('update_action', payload)} onCompare={compare} />)}
          {comparison && <div className={styles.item}><h3>Recorded results</h3><p>{comparison.warning}</p>{comparison.rows.length > 0 && <table><thead><tr><th>Metric</th><th>Baseline</th><th>Follow-up</th><th>Difference</th></tr></thead><tbody>{comparison.rows.map(row => <tr key={row.key}><th>{row.label} ({row.unit})</th><td>{number(row.before)}</td><td>{number(row.after)}</td><td>{row.difference > 0 ? '+' : ''}{number(row.difference)}</td></tr>)}</tbody></table>}</div>}
        </>}
      </fieldset></div>
    </section>
  </div>, document.body);
}
