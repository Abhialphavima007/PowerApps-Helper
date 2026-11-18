import React, { useState } from 'react';
import { api } from '../api.js';

function WorkItemCard({ item }) {
  return <details className="work-item">
    <summary><span className="pill muted">{item.type || 'Item'}</span> <b>AB#{item.id} · {item.title}</b> <span className="muted">{item.state}</span> {item.relation !== 'root' && <span className="muted">· {item.relation} of AB#{item.parentId}</span>}</summary>
    <div className="work-item-body">
      {item.description && <><b>Description</b><div className="notes">{item.description}</div></>}
      {item.acceptanceCriteria && <><b>Acceptance criteria</b><div className="notes">{item.acceptanceCriteria}</div></>}
      {item.reproSteps && <><b>Repro steps</b><div className="notes">{item.reproSteps}</div></>}
      <b>Comments ({item.comments?.length || 0})</b>
      {item.comments?.length ? item.comments.map((comment, index) => <div className="work-item-comment" key={index}><span className="muted">{comment.author} · {comment.createdAt ? new Date(comment.createdAt).toLocaleString() : ''}</span><div>{comment.text}</div></div>) : <div className="muted">No comments.</div>}
      <button className="btn small secondary" onClick={() => api.util.openExternal(item.url)}>Open in Azure DevOps</button>
    </div>
  </details>;
}

function StoryGroup({ rootId, items }) {
  const [visible, setVisible] = useState(50);
  const root = items.find((item) => item.id === rootId);
  return <details className="work-story-group" open={items.length < 100 ? true : undefined}>
    <summary><b>AB#{rootId} {root?.title ? `· ${root.title}` : ''}</b><span className="pill muted">{items.length} item{items.length === 1 ? '' : 's'}</span></summary>
    <div className="work-story-items">
      {items.slice(0, visible).map((item) => <WorkItemCard key={item.id} item={item} />)}
      {items.length > visible && <button className="btn small secondary" style={{ marginTop: 8 }} onClick={() => setVisible((count) => count + 50)}>Show 50 more · {items.length - visible} remaining</button>}
    </div>
  </details>;
}

export default function WorkItemDetails({ details }) {
  const roots = details.rootIds?.length ? details.rootIds : details.items.filter((item) => item.relation === 'root').map((item) => item.id);
  return <div className="work-item-list">
    <div className="muted">Loaded {details.items.length} work item{details.items.length === 1 ? '' : 's'} across {roots.length} stor{roots.length === 1 ? 'y' : 'ies'}.</div>
    {roots.map((rootId) => <StoryGroup key={rootId} rootId={rootId} items={details.items.filter((item) => (item.rootId || (item.relation === 'root' ? item.id : roots[0])) === rootId)} />)}
  </div>;
}
