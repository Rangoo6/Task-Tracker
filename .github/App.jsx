import { useState, useEffect, useRef } from "react";

// ── Capacitor plugins (loaded dynamically so web preview still works) ──
let LocalNotifications = null;
let CapStorage = null;
try {
  const cap = await import('@capacitor/local-notifications');
  LocalNotifications = cap.LocalNotifications;
} catch {}
try {
  const st = await import('@capacitor/storage');
  CapStorage = st.Storage;
} catch {}

// ── Storage adapter: uses Capacitor on device, localStorage on web ──
const store = {
  get: async (key) => {
    try {
      if (CapStorage) {
        const { value } = await CapStorage.get({ key });
        return value ? JSON.parse(value) : null;
      }
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  },
  set: async (key, value) => {
    try {
      if (CapStorage) {
        await CapStorage.set({ key, value: JSON.stringify(value) });
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch {}
  }
};

// ── Notification helper ──
let notifId = 1000;
const scheduleNotif = async (title, body, triggerSeconds) => {
  if (!LocalNotifications) return;
  try {
    await LocalNotifications.requestPermissions();
    await LocalNotifications.schedule({
      notifications: [{
        id: notifId++,
        title,
        body,
        schedule: { at: new Date(Date.now() + triggerSeconds * 1000) },
        sound: null,
        smallIcon: 'ic_stat_icon_config_sample',
        iconColor: '#5050F8',
      }]
    });
  } catch {}
};

const scheduleTaskReminders = async (task, minutesBefore, repeatEnabled, repeatEvery) => {
  if (!LocalNotifications) return;
  const [h, m] = task.time.split(":").map(Number);
  const now = new Date();
  const taskTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  const secsBefore = minutesBefore * 60;
  const triggerAt = taskTime.getTime() - secsBefore * 1000;
  const diff = (triggerAt - Date.now()) / 1000;
  if (diff > 0) {
    await scheduleNotif(`⏰ Coming up: ${task.icon} ${task.title}`, `Starts in ${minutesBefore} minute${minutesBefore > 1 ? 's' : ''}`, diff);
  }
  if (repeatEnabled && repeatEvery > 0) {
    const repeatSecs = repeatEvery * 60;
    for (let i = 1; i <= 6; i++) {
      const t = diff + i * repeatSecs;
      if (t > 0 && t < 8 * 3600) {
        await scheduleNotif(`🔔 Reminder: ${task.icon} ${task.title}`, `Don't forget — scheduled at ${fmtTime(task.time)}`, t);
      }
    }
  }
};

// ── Constants ──
const DAYS      = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const FULL_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS    = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const DEFAULT_TASKS = [
  { id:1, title:"Morning Exercise",    icon:"🏃", time:"06:00", color:"#3ECFA0" },
  { id:2, title:"Study / Work Block",  icon:"💻", time:"09:00", color:"#5B8AF5" },
  { id:3, title:"Design Work",         icon:"🎨", time:"11:00", color:"#C77EF5" },
  { id:4, title:"Prayer & Reflection", icon:"🕌", time:"13:00", color:"#F5C76E" },
  { id:5, title:"Crypto Analysis",     icon:"📊", time:"16:00", color:"#F57E6E" },
  { id:6, title:"Family Time",         icon:"🏠", time:"19:00", color:"#6EE8F5" },
];

const REMINDER_OPTS = [1,2,3,5,10,15,20,30,45,60,90,120];
const REPEAT_OPTS   = [1,2,3,5,10,15,20,30];
const ICONS  = ["🏃","💻","🎨","📊","🕌","🏠","📚","🍎","💊","🧘","🛒","📞","✍️","🎯","🌙","☕","🎵","🏋️","🚶","📝","🔬","🎮","🍳","🌿","💰","📰","🧹","🚿","🛏️","🎤"];
const COLORS = ["#3ECFA0","#5B8AF5","#C77EF5","#F5C76E","#F57E6E","#6EE8F5","#F5A06E","#A0F56E","#F56EA0","#6E8AF5","#F5E66E","#6EF5C7"];

function getTodayKey(){ const d=new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
function parseDateKey(k){ const[y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function fmtTime(t){ if(!t)return""; const[h,m]=t.split(":").map(Number); return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`; }

export default function App(){
  const [screen,setScreen]   = useState("home");
  const [tasks,setTasks]     = useState(DEFAULT_TASKS);
  const [dayLogs,setDayLogs] = useState({});
  const [selDate,setSelDate] = useState(getTodayKey());
  const [reasonModal,setReasonModal] = useState(null);
  const [reasonText,setReasonText]   = useState("");
  const [toast,setToast]     = useState({msg:"",type:"ok"});
  const [calLog,setCalLog]   = useState([]);
  const [syncModal,setSyncModal] = useState(null);
  const [calBusy,setCalBusy] = useState(false);
  const [rs,setRs]           = useState({ globalEnabled:true, globalMinutes:10, repeatEnabled:false, repeatEvery:5, overrides:{} });
  const [editReminderTask,setEditReminderTask] = useState(null);
  const [tmpOv,setTmpOv]     = useState({});
  const [taskEditor,setTaskEditor] = useState(null);
  const [deleteConfirm,setDeleteConfirm] = useState(null);

  // Load persisted data
  useEffect(()=>{
    (async()=>{
      const a = await store.get("dayLogs");  if(a) setDayLogs(a);
      const b = await store.get("tasks3");   if(b) setTasks(b);
      const c = await store.get("rs2");      if(c) setRs(c);
      const d = await store.get("calLog2");  if(d) setCalLog(d);
    })();
  },[]);

  // Schedule today's reminders on load
  useEffect(()=>{
    if(rs.globalEnabled && tasks.length > 0){
      tasks.forEach(task => {
        const eff = getEff(task.id);
        if(eff.enabled !== false) {
          scheduleTaskReminders(task, eff.minutes, eff.repeatEnabled, eff.repeatEvery);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const persist = (k,v) => store.set(k,v);
  const showToast=(msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast({msg:"",type:"ok"}),3000); };

  const getLog=(dk)=>dayLogs[dk]||{};

  const toggleDone=(tid)=>{
    const log=getLog(selDate); const ex=log[tid]||{};
    const up={...dayLogs,[selDate]:{...log,[tid]:{...ex,done:!ex.done}}};
    setDayLogs(up); persist("dayLogs",up);
    if(!ex.done) showToast("✅ Task complete!");
  };

  const saveReason=()=>{
    const log=getLog(selDate);
    const up={...dayLogs,[selDate]:{...log,[reasonModal.id]:{...log[reasonModal.id],reason:reasonText,done:false}}};
    setDayLogs(up); persist("dayLogs",up);
    setReasonModal(null); showToast("📝 Reason saved.");
  };

  // Task CRUD
  const openAddTask=()=>setTaskEditor({mode:"add",task:{id:Date.now(),title:"",icon:"📝",time:"08:00",color:COLORS[Math.floor(Math.random()*COLORS.length)]}});
  const openEditTask=(task)=>setTaskEditor({mode:"edit",task:{...task}});

  const saveTask=()=>{
    if(!taskEditor.task.title.trim()){ showToast("⚠️ Enter a task name","warn"); return; }
    let updated;
    if(taskEditor.mode==="add"){
      updated=[...tasks,{...taskEditor.task,id:Date.now()}];
      showToast("✅ Task added!");
    } else {
      updated=tasks.map(t=>t.id===taskEditor.task.id?{...taskEditor.task}:t);
      showToast("✏️ Task updated!");
    }
    setTasks(updated); persist("tasks3",updated);
    setTaskEditor(null);
    // Re-schedule reminders for this task
    const eff = getEff(taskEditor.task.id);
    scheduleTaskReminders(taskEditor.task, eff.minutes, eff.repeatEnabled, eff.repeatEvery);
  };

  const doDelete=()=>{
    const updated=tasks.filter(t=>t.id!==deleteConfirm.id);
    setTasks(updated); persist("tasks3",updated);
    setDeleteConfirm(null); showToast("🗑️ Task deleted.");
  };

  const moveTask=(idx,dir)=>{
    const arr=[...tasks]; const swap=idx+dir;
    if(swap<0||swap>=arr.length)return;
    [arr[idx],arr[swap]]=[arr[swap],arr[idx]];
    setTasks(arr); persist("tasks3",arr);
  };

  // Reminders
  const saveRs=(u)=>{ setRs(u); persist("rs2",u); };
  const getEff=(tid)=>{ const ov=rs.overrides?.[tid]; return ov||{enabled:rs.globalEnabled,minutes:rs.globalMinutes,repeatEnabled:rs.repeatEnabled,repeatEvery:rs.repeatEvery}; };
  const saveOverride=()=>{
    const updated={...rs,overrides:{...rs.overrides,[editReminderTask.id]:{...tmpOv}}};
    saveRs(updated);
    setEditReminderTask(null); showToast("⏰ Reminder saved!");
    scheduleTaskReminders(editReminderTask, tmpOv.minutes, tmpOv.repeatEnabled, tmpOv.repeatEvery);
  };
  const clearOverride=(tid)=>{ const{[tid]:_,...rest}=rs.overrides||{}; saveRs({...rs,overrides:rest}); showToast("Reset to global."); };

  // Google Calendar sync
  const syncTask=async(task)=>{
    setCalBusy(true);
    const eff=getEff(task.id);
    const today=new Date(); const[h,m]=task.time.split(":").map(Number);
    const start=new Date(today.getFullYear(),today.getMonth(),today.getDate(),h,m,0);
    const end  =new Date(today.getFullYear(),today.getMonth(),today.getDate(),h,m+30,0);
    const rList=[{method:"popup",minutes:eff.minutes}];
    if(eff.repeatEnabled&&eff.repeatEvery>0){
      for(let i=eff.repeatEvery;i<eff.minutes;i+=eff.repeatEvery)rList.push({method:"popup",minutes:eff.minutes-i});
      rList.push({method:"popup",minutes:0});
    }
    let ok=false;
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,
          messages:[{role:"user",content:`Create Google Calendar event: Title "${task.icon} ${task.title}", Start ${start.toISOString()}, End ${end.toISOString()}, Description "Task Tracker", Reminders: ${rList.map(r=>r.minutes+"min").join(",")}. Use create_event. Reply only JSON {"ok":true}`}],
          mcp_servers:[{type:"url",url:"https://calendarmcp.googleapis.com/mcp/v1",name:"gcal"}]
        })
      });
      const data=await res.json();
      ok=(data.content||[]).some(b=>b.type==="mcp_tool_result")||(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").includes("ok");
    }catch{}
    const entry={taskId:task.id,taskTitle:task.title,icon:task.icon,time:task.time,reminderMin:eff.minutes,repeat:eff.repeatEnabled?eff.repeatEvery:null,syncedAt:new Date().toISOString(),ok};
    const nl=[entry,...calLog.slice(0,19)]; setCalLog(nl); persist("calLog2",nl);
    setCalBusy(false); setSyncModal(null);
    showToast(ok?`📅 "${task.title}" synced!`:"⚠️ Check Google Calendar",ok?"ok":"warn");
  };
  const syncAll=async()=>{ showToast("🔄 Syncing…"); for(const t of tasks)await syncTask(t); };

  // Stats
  const todayKey=getTodayKey();
  const todayLog=getLog(selDate);
  const doneCount=tasks.filter(t=>todayLog[t.id]?.done).length;
  const pctDone=tasks.length>0?(doneCount/tasks.length)*100:0;
  const selDateObj=parseDateKey(selDate);

  const calcStreak=()=>{
    let s=0; const now=new Date();
    for(let i=0;i<30;i++){
      const d=new Date(now); d.setDate(now.getDate()-i);
      const k=`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
      if(tasks.every(t=>(dayLogs[k]||{})[t.id]?.done)&&tasks.length>0)s++; else if(i>0)break;
    } return s;
  };

  const getLast14=()=>{
    const days=[]; const now=new Date();
    for(let i=13;i>=0;i--){
      const d=new Date(now); d.setDate(now.getDate()-i);
      const k=`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
      days.push({key:k,date:d,done:tasks.filter(t=>(dayLogs[k]||{})[t.id]?.done).length,total:tasks.length});
    } return days;
  };

  // Styles
  const C={ bg:"#09090F",card:"#101018",border:"#1A1A26",accent:"#5050F8",green:"#30C878",amber:"#E89A40",text:"#E0E0F8",sub:"#6060A0" };
  const cardS=(ex={})=>({background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"16px 18px",marginBottom:11,...ex});
  const btnS=(bg,col="#fff",ex={})=>({background:bg,border:"none",borderRadius:14,padding:"13px 0",color:col,fontSize:14,fontWeight:700,cursor:"pointer",width:"100%",...ex});
  const inpS={width:"100%",boxSizing:"border-box",background:"#06060C",border:`1px solid ${C.border}`,borderRadius:14,padding:"12px 16px",color:C.text,fontSize:14,outline:"none",fontFamily:"inherit"};
  const togS=(on)=>({width:48,height:26,borderRadius:13,cursor:"pointer",background:on?C.accent:"#252535",position:"relative",transition:"all .3s",border:"none",flexShrink:0});
  const dotS=(on)=>({width:20,height:20,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:on?25:3,transition:"left .3s"});
  const chipS=(on,col=C.accent)=>({background:on?col+"22":"#0E0E1A",border:`1px solid ${on?col:"#22223A"}`,borderRadius:20,padding:"6px 14px",color:on?col:"#6060A0",fontSize:12,cursor:"pointer"});
  const tc=toast.type==="err"?"#CC3333":toast.type==="warn"?"#CC8833":C.green;

  const TABS=[{id:"home",icon:"🏠",label:"Home"},{id:"tasks",icon:"✏️",label:"Tasks"},{id:"reminder",icon:"⏰",label:"Alerts"},{id:"calendar",icon:"📅",label:"Calendar"},{id:"history",icon:"📈",label:"History"}];

  // Task Editor Sheet
  const TaskEditorSheet=()=>{
    if(!taskEditor)return null;
    const t=taskEditor.task;
    const set=(k,v)=>setTaskEditor({...taskEditor,task:{...t,[k]:v}});
    return(
      <div style={{position:"fixed",inset:0,background:"#000D",zIndex:999,display:"flex",alignItems:"flex-end"}} onClick={e=>e.target===e.currentTarget&&setTaskEditor(null)}>
        <div style={{background:"#0D0D16",borderRadius:"28px 28px 0 0",padding:"0 0 40px",width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,maxHeight:"92vh",overflowY:"auto"}}>
          <div style={{position:"sticky",top:0,background:"#0D0D16",padding:"14px 22px 0",zIndex:1}}>
            <div style={{width:38,height:4,borderRadius:2,background:"#252535",margin:"0 auto 18px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:11,color:C.sub,textTransform:"uppercase",letterSpacing:2}}>{taskEditor.mode==="add"?"New Task":"Edit Task"}</div>
                <div style={{fontSize:20,fontWeight:800,marginTop:2}}>{taskEditor.mode==="add"?"Create Your Task":"Customise Task"}</div>
              </div>
              <button onClick={()=>setTaskEditor(null)} style={{background:"#1A1A26",border:"none",borderRadius:12,width:36,height:36,color:C.sub,fontSize:18,cursor:"pointer"}}>×</button>
            </div>
          </div>
          <div style={{padding:"0 22px"}}>
            <div style={{background:`${t.color||C.accent}12`,border:`1px solid ${t.color||C.accent}30`,borderRadius:18,padding:"14px 18px",marginBottom:22,display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:46,height:46,borderRadius:14,background:`${t.color||C.accent}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{t.icon||"📝"}</div>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:t.color||C.accent}}>{t.title||"Task Name"}</div>
                <div style={{fontSize:12,color:C.sub,marginTop:2}}>🕐 {fmtTime(t.time)||"—"}</div>
              </div>
            </div>
            <div style={{fontSize:12,color:C.sub,marginBottom:8,letterSpacing:.5}}>TASK NAME</div>
            <input value={t.title} onChange={e=>set("title",e.target.value)} placeholder="e.g. Morning Walk, Study Session…" style={{...inpS,marginBottom:22,fontSize:15}}/>
            <div style={{fontSize:12,color:C.sub,marginBottom:8,letterSpacing:.5}}>TIME</div>
            <div style={{position:"relative",marginBottom:22}}>
              <input type="time" value={t.time} onChange={e=>set("time",e.target.value)} style={{...inpS,fontSize:22,fontWeight:800,textAlign:"center",letterSpacing:3,padding:"16px 0"}}/>
              <div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",fontSize:13,color:C.sub}}>{fmtTime(t.time)}</div>
            </div>
            <div style={{fontSize:12,color:C.sub,marginBottom:10,letterSpacing:.5}}>ICON</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:22}}>
              {ICONS.map(ic=>(
                <button key={ic} onClick={()=>set("icon",ic)} style={{width:42,height:42,borderRadius:12,fontSize:20,cursor:"pointer",background:t.icon===ic?`${t.color||C.accent}22`:"#0E0E1A",border:`2px solid ${t.icon===ic?t.color||C.accent:"#1E1E2E"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>{ic}</button>
              ))}
            </div>
            <div style={{fontSize:12,color:C.sub,marginBottom:10,letterSpacing:.5}}>ACCENT COLOR</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:28}}>
              {COLORS.map(col=>(
                <button key={col} onClick={()=>set("color",col)} style={{width:34,height:34,borderRadius:"50%",background:col,border:`3px solid ${t.color===col?"#fff":"transparent"}`,cursor:"pointer",outline:t.color===col?`2px solid ${col}`:"none",outlineOffset:2}}/>
              ))}
            </div>
            <button onClick={saveTask} style={{...btnS(`linear-gradient(135deg,${t.color||C.accent},${t.color||C.accent}99)`),fontSize:15,padding:"15px 0"}}>
              {taskEditor.mode==="add"?"✅  Add Task":"💾  Save Changes"}
            </button>
            {taskEditor.mode==="edit"&&(
              <button onClick={()=>{setTaskEditor(null);setDeleteConfirm(t);}} style={{...btnS("transparent","#CC4444"),border:"1px solid #441818",marginTop:10}}>🗑️  Delete Task</button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return(
    <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:C.bg,minHeight:"100vh",maxWidth:430,margin:"0 auto",color:C.text,position:"relative",WebkitUserSelect:"none",userSelect:"none"}}>

      {toast.msg&&<div style={{position:"fixed",top:52,left:"50%",transform:"translateX(-50%)",background:"#0E0E18",border:`1px solid ${tc}44`,padding:"10px 22px",borderRadius:28,fontSize:13,zIndex:9999,color:"#D0D0EE",boxShadow:"0 6px 30px #0009",whiteSpace:"nowrap",maxWidth:340,textAlign:"center"}}>{toast.msg}</div>}

      <TaskEditorSheet/>

      {deleteConfirm&&(
        <div style={{position:"fixed",inset:0,background:"#000D",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 24px"}}>
          <div style={{background:"#0D0D16",borderRadius:24,padding:28,width:"100%",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:28,textAlign:"center",marginBottom:12}}>🗑️</div>
            <div style={{fontSize:17,fontWeight:800,textAlign:"center",marginBottom:8}}>Delete Task?</div>
            <div style={{fontSize:14,color:C.sub,textAlign:"center",marginBottom:24}}>"{deleteConfirm.icon} {deleteConfirm.title}" will be removed.</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setDeleteConfirm(null)} style={{...btnS("#1A1A26","#7070B0"),flex:1}}>Cancel</button>
              <button onClick={doDelete} style={{...btnS("#CC2222"),flex:1}}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {reasonModal&&(
        <div style={{position:"fixed",inset:0,background:"#000C",zIndex:998,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:"#0D0D16",borderRadius:"26px 26px 0 0",padding:"26px 22px 36px",width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`}}>
            <div style={{width:38,height:4,borderRadius:2,background:"#252535",margin:"0 auto 22px"}}/>
            <div style={{fontSize:11,color:C.sub,textTransform:"uppercase",letterSpacing:2,marginBottom:6}}>Why did you skip?</div>
            <div style={{fontSize:16,fontWeight:700,marginBottom:18}}>{reasonModal.icon} {reasonModal.title}</div>
            <textarea value={reasonText} onChange={e=>setReasonText(e.target.value)} placeholder="What stopped you today?" style={{...inpS,resize:"none",height:88,lineHeight:1.6}}/>
            <div style={{display:"flex",gap:10,marginTop:13}}>
              <button onClick={()=>setReasonModal(null)} style={{...btnS("#14141E","#6060A0"),flex:1}}>Cancel</button>
              <button onClick={saveReason} style={{...btnS(C.accent),flex:2}}>Save</button>
            </div>
          </div>
        </div>
      )}

      {syncModal&&(
        <div style={{position:"fixed",inset:0,background:"#000C",zIndex:998,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:"#0D0D16",borderRadius:"26px 26px 0 0",padding:"26px 22px 36px",width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`}}>
            <div style={{width:38,height:4,borderRadius:2,background:"#252535",margin:"0 auto 22px"}}/>
            <div style={{fontSize:11,color:C.sub,textTransform:"uppercase",letterSpacing:2,marginBottom:6}}>Sync to Google Calendar</div>
            <div style={{fontSize:18,fontWeight:800,marginBottom:4,color:syncModal.color||C.text}}>{syncModal.icon} {syncModal.title}</div>
            <div style={{fontSize:13,color:C.sub,marginBottom:18}}>🕐 {fmtTime(syncModal.time)}</div>
            {(()=>{ const eff=getEff(syncModal.id); return(
              <div style={{background:"#09090F",borderRadius:14,padding:"14px 18px",marginBottom:20,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,color:C.sub,marginBottom:8}}>Reminder config</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <span style={chipS(true,"#7777FF")}>🔔 {eff.minutes} min before</span>
                  {eff.repeatEnabled&&<span style={chipS(true,C.green)}>↻ every {eff.repeatEvery} min</span>}
                </div>
              </div>
            ); })()}
            {calBusy?<div style={{textAlign:"center",color:C.accent,padding:"16px 0",fontWeight:700}}>⏳ Creating event…</div>:(
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setSyncModal(null)} style={{...btnS("#14141E","#6060A0"),flex:1}}>Cancel</button>
                <button onClick={()=>syncTask(syncModal)} style={{...btnS(`linear-gradient(135deg,${C.accent},#8844DD)`),flex:2}}>📅 Add to Calendar</button>
              </div>
            )}
          </div>
        </div>
      )}

      {editReminderTask&&(
        <div style={{position:"fixed",inset:0,background:"#000C",zIndex:998,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:"#0D0D16",borderRadius:"26px 26px 0 0",padding:"26px 22px 36px",width:"100%",boxSizing:"border-box",border:`1px solid ${C.border}`,maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{width:38,height:4,borderRadius:2,background:"#252535",margin:"0 auto 22px"}}/>
            <div style={{fontSize:11,color:C.sub,textTransform:"uppercase",letterSpacing:2,marginBottom:6}}>Custom Reminder</div>
            <div style={{fontSize:17,fontWeight:800,marginBottom:22}}>{editReminderTask.icon} {editReminderTask.title}</div>
            <div style={{fontSize:13,color:C.sub,marginBottom:10}}>Remind me before task</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:22}}>
              {REMINDER_OPTS.map(m=><button key={m} onClick={()=>setTmpOv({...tmpOv,minutes:m})} style={chipS(tmpOv.minutes===m)}>{m<60?`${m}m`:`${m/60}h`}</button>)}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:tmpOv.repeatEnabled?16:22}}>
              <div><div style={{fontSize:14,fontWeight:700}}>Repeat Reminder</div><div style={{fontSize:12,color:"#44446A",marginTop:2}}>Keep pinging until done</div></div>
              <button onClick={()=>setTmpOv({...tmpOv,repeatEnabled:!tmpOv.repeatEnabled})} style={togS(tmpOv.repeatEnabled)}><div style={dotS(tmpOv.repeatEnabled)}/></button>
            </div>
            {tmpOv.repeatEnabled&&(
              <div style={{marginBottom:22}}>
                <div style={{fontSize:13,color:C.sub,marginBottom:10}}>Repeat every</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                  {REPEAT_OPTS.map(m=><button key={m} onClick={()=>setTmpOv({...tmpOv,repeatEvery:m})} style={chipS(tmpOv.repeatEvery===m,C.green)}>{m} min</button>)}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setEditReminderTask(null)} style={{...btnS("#14141E","#6060A0"),flex:1}}>Cancel</button>
              <button onClick={saveOverride} style={{...btnS(C.accent),flex:2}}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ HOME ═══ */}
      {screen==="home"&&(
        <div style={{paddingBottom:90}}>
          <div style={{padding:"52px 22px 0"}}>
            <div style={{fontSize:11,color:"#40408A",letterSpacing:2,textTransform:"uppercase"}}>{FULL_DAYS[selDateObj.getDay()]}, {MONTHS[selDateObj.getMonth()]} {selDateObj.getDate()}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginTop:4}}>
              <div style={{fontSize:27,fontWeight:800,lineHeight:1.2}}>{selDate===todayKey?"Today's Tasks":`${MONTHS[selDateObj.getMonth()]} ${selDateObj.getDate()}`}</div>
              <div style={{display:"flex",gap:7,marginTop:6}}>
                <span style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 11px",fontSize:12,color:C.amber}}>🔥 {calcStreak()}</span>
                <span style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 11px",fontSize:12,color:C.sub}}>{doneCount}/{tasks.length}</span>
              </div>
            </div>
          </div>
          <div style={{margin:"16px 22px 0"}}>
            <div style={{background:C.card,borderRadius:8,height:5,overflow:"hidden"}}>
              <div style={{width:`${pctDone}%`,height:"100%",background:pctDone===100?C.green:C.accent,borderRadius:8,transition:"width .5s ease"}}/>
            </div>
            <div style={{fontSize:11,color:"#33335A",marginTop:5}}>{Math.round(pctDone)}% complete</div>
          </div>
          <div style={{display:"flex",gap:8,padding:"18px 22px 0",overflowX:"auto",scrollbarWidth:"none"}}>
            {getLast14().slice(-7).map(({key,date,done,total})=>{
              const p=total>0?done/total:0; const isSel=key===selDate;
              return(<button key={key} onClick={()=>setSelDate(key)} style={{background:isSel?C.accent:C.card,border:`1px solid ${isSel?C.accent:C.border}`,borderRadius:16,padding:"10px 14px",cursor:"pointer",flexShrink:0,minWidth:50}}>
                <div style={{fontSize:9,color:isSel?"#B0B0FF":"#38388A",textTransform:"uppercase",letterSpacing:1}}>{DAYS[date.getDay()]}</div>
                <div style={{fontSize:17,fontWeight:800,color:isSel?"#fff":"#DDDDF0",margin:"4px 0 5px"}}>{date.getDate()}</div>
                <div style={{display:"flex",justifyContent:"center",gap:2}}>{[...Array(Math.min(total,4))].map((_,i)=><div key={i} style={{width:4,height:4,borderRadius:"50%",background:i<Math.round(p*Math.min(total,4))?(p===1?C.green:C.accent):"#252535"}}/>)}</div>
              </button>);
            })}
          </div>
          <div style={{padding:"16px 22px 0"}}>
            {tasks.length===0?(
              <div style={{textAlign:"center",padding:"48px 0",color:C.sub}}>
                <div style={{fontSize:40,marginBottom:12}}>📋</div>
                <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>No tasks yet</div>
                <div style={{fontSize:13,marginBottom:20}}>Go to Tasks tab to build your schedule</div>
                <button onClick={()=>setScreen("tasks")} style={{...btnS(C.accent),width:"auto",padding:"11px 28px"}}>+ Add Task</button>
              </div>
            ):tasks.map(task=>{
              const log=todayLog[task.id]||{}; const done=!!log.done; const hasR=!!log.reason;
              const eff=getEff(task.id); const hasOv=!!rs.overrides?.[task.id]; const col=task.color||C.accent;
              return(<div key={task.id} style={{background:done?`${col}08`:C.card,border:`1px solid ${done?col+"20":C.border}`,borderRadius:20,padding:"15px 17px",marginBottom:10,display:"flex",alignItems:"center",gap:13,transition:"all .3s"}}>
                <button onClick={()=>toggleDone(task.id)} style={{width:40,height:40,borderRadius:13,flexShrink:0,background:done?col+"33":"#141420",border:`2px solid ${done?col:"#252535"}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,transition:"all .25s"}}>
                  {done?<span style={{color:col,fontWeight:900,fontSize:18}}>✓</span>:<span>{task.icon}</span>}
                </button>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:done?"#405050":C.text,textDecoration:done?"line-through":"none"}}>{task.title}</div>
                  <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,color:col+"AA"}}>🕐 {fmtTime(task.time)}</span>
                    <span style={{fontSize:11,color:hasOv?"#9966EE":"#30305A"}}>🔔{eff.minutes}m{eff.repeatEnabled?` ↻${eff.repeatEvery}m`:""}</span>
                  </div>
                  {hasR&&!done&&<div style={{fontSize:11,color:C.amber,marginTop:4,fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>"{log.reason}"</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  <button onClick={()=>setSyncModal(task)} style={{background:"#0A0A18",border:"1px solid #1E1E44",borderRadius:10,padding:"5px 10px",fontSize:11,color:"#5555BB",cursor:"pointer"}}>📅</button>
                  {!done&&<button onClick={()=>{setReasonText((todayLog[task.id]?.reason)||"");setReasonModal(task);}} style={{background:hasR?"#1C1000":"#0E0E18",border:`1px solid ${hasR?"#443300":C.border}`,borderRadius:10,padding:"5px 8px",fontSize:11,color:hasR?C.amber:C.sub,cursor:"pointer"}}>{hasR?"✏️":"Skip"}</button>}
                </div>
              </div>);
            })}
          </div>
        </div>
      )}

      {/* ═══ TASKS ═══ */}
      {screen==="tasks"&&(
        <div style={{paddingBottom:100}}>
          <div style={{padding:"52px 22px 0",marginBottom:20}}>
            <div style={{fontSize:11,color:"#40408A",letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Customise</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:26,fontWeight:800}}>My Tasks</div>
              <button onClick={openAddTask} style={{background:`linear-gradient(135deg,${C.accent},#8844DD)`,border:"none",borderRadius:14,padding:"10px 18px",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:16}}>＋</span> New</button>
            </div>
            <div style={{fontSize:13,color:C.sub,marginTop:6}}>{tasks.length} task{tasks.length!==1?"s":""} · tap to edit, arrows to reorder</div>
          </div>
          <div style={{padding:"0 22px"}}>
            {tasks.length===0?(
              <div style={{textAlign:"center",padding:"60px 0",color:C.sub}}>
                <div style={{fontSize:56,marginBottom:16}}>✨</div>
                <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Start Fresh</div>
                <div style={{fontSize:13,marginBottom:24}}>Build your perfect daily schedule</div>
                <button onClick={openAddTask} style={{...btnS(`linear-gradient(135deg,${C.accent},#8844DD)`),width:"auto",padding:"13px 32px",fontSize:15}}>+ Create First Task</button>
              </div>
            ):tasks.map((task,idx)=>{
              const col=task.color||C.accent;
              return(<div key={task.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"14px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:46,height:46,borderRadius:14,background:`${col}18`,border:`1.5px solid ${col}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{task.icon}</div>
                <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>openEditTask(task)}>
                  <div style={{fontSize:15,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.title}</div>
                  <div style={{display:"flex",gap:8,marginTop:4}}>
                    <span style={{fontSize:12,color:col,fontWeight:600}}>🕐 {fmtTime(task.time)}</span>
                    <span style={{width:5,height:5,borderRadius:"50%",background:col,alignSelf:"center",flexShrink:0}}/>
                    <span style={{fontSize:12,color:C.sub}}>{getEff(task.id).minutes}m reminder</span>
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  <button onClick={()=>moveTask(idx,-1)} disabled={idx===0} style={{background:idx===0?"transparent":"#14141E",border:`1px solid ${idx===0?"transparent":C.border}`,borderRadius:8,width:28,height:24,color:idx===0?"#252535":C.sub,cursor:idx===0?"default":"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>▲</button>
                  <button onClick={()=>moveTask(idx,1)} disabled={idx===tasks.length-1} style={{background:idx===tasks.length-1?"transparent":"#14141E",border:`1px solid ${idx===tasks.length-1?"transparent":C.border}`,borderRadius:8,width:28,height:24,color:idx===tasks.length-1?"#252535":C.sub,cursor:idx===tasks.length-1?"default":"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>▼</button>
                </div>
                <button onClick={()=>openEditTask(task)} style={{background:"#14141E",border:`1px solid ${C.border}`,borderRadius:12,padding:"8px 12px",fontSize:12,color:C.sub,cursor:"pointer",flexShrink:0}}>Edit</button>
              </div>);
            })}
            {tasks.length>0&&<button onClick={openAddTask} style={{width:"100%",background:"transparent",border:`1.5px dashed ${C.border}`,borderRadius:20,padding:"16px 0",color:"#30305A",fontSize:14,cursor:"pointer",marginTop:4,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><span style={{fontSize:20}}>＋</span> Add Another Task</button>}
          </div>
        </div>
      )}

      {/* ═══ REMINDERS ═══ */}
      {screen==="reminder"&&(
        <div style={{padding:"52px 22px 100px"}}>
          <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>⏰ Reminders</div>
          <div style={{fontSize:13,color:C.sub,marginBottom:22}}>Global defaults + per-task customisation</div>
          <div style={cardS()}>
            <div style={{fontSize:11,color:"#40408A",textTransform:"uppercase",letterSpacing:1.5,marginBottom:14}}>Global Defaults</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div style={{fontSize:14,fontWeight:700}}>Enable Reminders</div><div style={{fontSize:12,color:"#44446A",marginTop:2}}>For all tasks</div></div>
              <button onClick={()=>saveRs({...rs,globalEnabled:!rs.globalEnabled})} style={togS(rs.globalEnabled)}><div style={dotS(rs.globalEnabled)}/></button>
            </div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:13,color:C.sub,marginBottom:10}}>Remind before task</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:7}}>{REMINDER_OPTS.map(m=><button key={m} onClick={()=>saveRs({...rs,globalMinutes:m})} style={chipS(rs.globalMinutes===m)}>{m<60?`${m} min`:`${m/60} hr`}</button>)}</div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:rs.repeatEnabled?16:0}}>
              <div><div style={{fontSize:14,fontWeight:700}}>Repeat Reminder</div><div style={{fontSize:12,color:"#44446A",marginTop:2}}>Keep alerting until done</div></div>
              <button onClick={()=>saveRs({...rs,repeatEnabled:!rs.repeatEnabled})} style={togS(rs.repeatEnabled)}><div style={dotS(rs.repeatEnabled)}/></button>
            </div>
            {rs.repeatEnabled&&<div style={{marginTop:16}}><div style={{fontSize:13,color:C.sub,marginBottom:10}}>Repeat every</div><div style={{display:"flex",flexWrap:"wrap",gap:7}}>{REPEAT_OPTS.map(m=><button key={m} onClick={()=>saveRs({...rs,repeatEvery:m})} style={chipS(rs.repeatEvery===m,C.green)}>{m} min</button>)}</div></div>}
          </div>
          <div style={{fontSize:11,color:"#40408A",textTransform:"uppercase",letterSpacing:1.5,margin:"20px 0 12px"}}>Per-Task Override</div>
          {tasks.map(task=>{
            const hasOv=!!rs.overrides?.[task.id]; const eff=getEff(task.id); const col=task.color||C.accent;
            return(<div key={task.id} style={{...cardS(),display:"flex",alignItems:"center",gap:13}}>
              <div style={{width:38,height:38,borderRadius:12,background:`${col}18`,border:`1.5px solid ${col}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{task.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700}}>{task.title}</div>
                <div style={{display:"flex",gap:7,marginTop:5,flexWrap:"wrap"}}>
                  <span style={{background:"#0E0E1A",borderRadius:20,padding:"3px 11px",fontSize:11,color:hasOv?"#9966EE":C.sub}}>🔔 {eff.minutes}m</span>
                  {eff.repeatEnabled&&<span style={{background:"#0E0E1A",borderRadius:20,padding:"3px 11px",fontSize:11,color:C.green}}>↻{eff.repeatEvery}m</span>}
                  {hasOv&&<span style={{background:"#180A28",borderRadius:20,padding:"3px 11px",fontSize:11,color:"#9966EE"}}>custom</span>}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <button onClick={()=>{setTmpOv({...eff});setEditReminderTask(task);}} style={{background:"#0E0E1A",border:`1px solid ${C.border}`,borderRadius:10,padding:"5px 12px",fontSize:11,color:C.sub,cursor:"pointer"}}>Edit</button>
                {hasOv&&<button onClick={()=>clearOverride(task.id)} style={{background:"#140A0A",border:"1px solid #331818",borderRadius:10,padding:"5px 12px",fontSize:11,color:"#AA4444",cursor:"pointer"}}>Reset</button>}
              </div>
            </div>);
          })}
        </div>
      )}

      {/* ═══ CALENDAR ═══ */}
      {screen==="calendar"&&(
        <div style={{padding:"52px 22px 100px"}}>
          <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>📅 Google Calendar</div>
          <div style={{fontSize:13,color:C.sub,marginBottom:22}}>Sync tasks & reminders to your calendar</div>
          <button onClick={syncAll} disabled={calBusy} style={{...btnS(`linear-gradient(135deg,${C.accent},#8844DD)`),marginBottom:20,fontSize:15,opacity:calBusy?0.6:1}}>{calBusy?"⏳ Syncing…":"🔄 Sync All Tasks Today"}</button>
          <div style={{background:"#0A0A18",border:"1px solid #1A1A32",borderRadius:16,padding:"13px 18px",marginBottom:22}}>
            <div style={{fontSize:12,color:"#40408A",marginBottom:6}}>How it works</div>
            <div style={{fontSize:12,color:C.sub,lineHeight:1.7}}>Tap <b style={{color:C.text}}>📅</b> on any task to create a Google Calendar event with your reminder timings set automatically.</div>
          </div>
          <div style={{fontSize:11,color:"#40408A",textTransform:"uppercase",letterSpacing:1.5,marginBottom:12}}>Tasks</div>
          {tasks.map(task=>{ const eff=getEff(task.id); const synced=calLog.find(l=>l.taskId===task.id&&l.ok); const col=task.color||C.accent;
            return(<div key={task.id} style={{...cardS(),display:"flex",alignItems:"center",gap:13}}>
              <div style={{width:40,height:40,borderRadius:12,background:`${col}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{task.icon}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700}}>{task.title}</div>
                <div style={{display:"flex",gap:7,marginTop:4,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:col}}>🕐 {fmtTime(task.time)}</span>
                  <span style={{fontSize:11,color:C.sub}}>🔔{eff.minutes}m</span>
                  {eff.repeatEnabled&&<span style={{fontSize:11,color:C.green}}>↻{eff.repeatEvery}m</span>}
                </div>
                {synced&&<div style={{fontSize:10,color:C.green,marginTop:4}}>✓ Synced {new Date(synced.syncedAt).toLocaleDateString()}</div>}
              </div>
              <button onClick={()=>setSyncModal(task)} disabled={calBusy} style={{background:synced?"#0A180E":"#0A0A18",border:`1px solid ${synced?"#1A4028":"#1E1E44"}`,borderRadius:12,padding:"8px 14px",fontSize:12,color:synced?C.green:"#5555BB",cursor:"pointer",fontWeight:600}}>{synced?"✓ Re-sync":"📅 Add"}</button>
            </div>);
          })}
          {calLog.length>0&&<>
            <div style={{fontSize:11,color:"#40408A",textTransform:"uppercase",letterSpacing:1.5,margin:"20px 0 12px"}}>Sync History</div>
            {calLog.slice(0,5).map((e,i)=>(
              <div key={i} style={{...cardS({padding:"12px 17px"})}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:14}}>{e.icon} {e.taskTitle}</span>
                  <span style={{fontSize:11,color:e.ok?C.green:"#CC4444"}}>{e.ok?"✓ OK":"✗ Failed"}</span>
                </div>
                <div style={{fontSize:11,color:"#30305A",marginTop:4}}>{fmtTime(e.time)} · 🔔{e.reminderMin}m{e.repeat?` · ↻${e.repeat}m`:""}</div>
              </div>
            ))}
          </>}
        </div>
      )}

      {/* ═══ HISTORY ═══ */}
      {screen==="history"&&(
        <div style={{padding:"52px 22px 100px"}}>
          <div style={{fontSize:22,fontWeight:800,marginBottom:20}}>📈 History</div>
          {getLast14().reverse().map(({key,date,done,total})=>{
            const p=total>0?Math.round((done/total)*100):0; const col=p===100?C.green:p>=50?C.amber:"#EE5555";
            return(<div key={key} style={{...cardS(),display:"flex",alignItems:"center",gap:14,cursor:"pointer"}} onClick={()=>{setSelDate(key);setScreen("home");}}>
              <div style={{width:46,height:46,borderRadius:15,background:p===100?"#0C1C14":C.card,border:`2px solid ${col}33`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:13,fontWeight:800,color:col}}>{date.getDate()}</div>
                <div style={{fontSize:9,color:"#30305A"}}>{MONTHS[date.getMonth()]}</div>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700}}>{FULL_DAYS[date.getDay()]}</div>
                <div style={{background:"#141420",borderRadius:6,height:4,marginTop:7,overflow:"hidden"}}>
                  <div style={{width:`${p}%`,height:"100%",background:col,borderRadius:6}}/>
                </div>
                <div style={{fontSize:11,color:"#30305A",marginTop:4}}>{done}/{total} tasks</div>
              </div>
              <div style={{fontSize:24,fontWeight:800,color:col}}>{p}%</div>
            </div>);
          })}
        </div>
      )}

      {/* Bottom Nav */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#07070D",borderTop:`1px solid ${C.border}`,display:"flex",padding:"10px 0 22px"}}>
        {TABS.map(tab=>(
          <button key={tab.id} onClick={()=>setScreen(tab.id)} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:0}}>
            <span style={{fontSize:19}}>{tab.icon}</span>
            <span style={{fontSize:9,color:screen===tab.id?"#7B7BFF":"#30305A",fontWeight:screen===tab.id?700:400}}>{tab.label}</span>
            {screen===tab.id&&<div style={{width:4,height:4,borderRadius:"50%",background:"#7B7BFF"}}/>}
          </button>
        ))}
      </div>
    </div>
  );
}
