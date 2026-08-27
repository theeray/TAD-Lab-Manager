const STORAGE_KEY='tadCostingPrototype.v1';
const PRICING_KEY='tadCostingPrototype.pricing.v1';
const TIER_KEY='tadCostingPrototype.tiers.v1';

const options={
  affiliations:['Faculty','Staff','Student','Community member','Alumni','Other'],
  projectFor:['Assignment for a TADD or TADT class','Assignment for another class','Non-assignment (BSU related)','Community Project','Personal Project','Community Ed Class','Other'],
  payment:['School Funds','Cash','Personal Check','Fundraiser','Office budget','Other'],
  approval:['Yes','I have determined this project does not require approval','No','Pending'],
  tadHelp:['No','Yes','I submitted this project to the Digital Corps design team',"I'll try to find someone"],
  units:['Inches','Feet','Yards','Meters','Millimeters','Grams (3D Print)','Each']
};

const defaultPricing=[
  {id:'sheet-metal',name:'Sheet Metal',method:'sheetMetalTier',rate:0.0100,finishGroup:'metal',active:true,demo:true},
  {id:'special-sheet-metal',name:'Special Sheet Metal',method:'sqin',rate:0.0180,finishGroup:'metal',active:true,demo:true},
  {id:'plywood',name:'Plywood',method:'sqin',rate:0.0120,finishGroup:'wood',active:true,demo:true},
  {id:'masonite',name:'Masonite',method:'sqin',rate:0.0060,finishGroup:'wood',active:true,demo:true},
  {id:'cardboard',name:'Cardboard',method:'sqin',rate:0.0025,finishGroup:'sheet',active:true,demo:true},
  {id:'3d-plastic',name:'3D Printer Plastic',method:'gram',rate:0.08,finishGroup:'printed',active:true,demo:true},
  {id:'clear-acrylic',name:'Clear Acrylic',method:'sqin',rate:0.0250,finishGroup:'sheet',active:true,demo:true},
  {id:'vinyl',name:'Vinyl',method:'sqin',rate:0.0045,finishGroup:'print',active:true,demo:true},
  {id:'grimco-vinyl',name:'Vinyl (ink print): Grimco IM3201 Matte',method:'sqin',rate:0.0045,finishGroup:'print',active:true,demo:true},
  {id:'briteline-lowtack',name:'Low-Tack Briteline 3202',method:'sqin',rate:0.0050,finishGroup:'print',active:true,demo:true},
  {id:'briteline-3201',name:'Low-Tac Briteline 3201-54',method:'sqin',rate:0.0050,finishGroup:'print',active:true,demo:true},
  {id:'backlit-textile',name:'Generic Backlit Textile for beMatrix Frames',method:'sqin',rate:0.0070,finishGroup:'print',active:true,demo:true},
  {id:'transfer-paper',name:'Transfer Paper',method:'sqin',rate:0.0020,finishGroup:'print',active:true,demo:true},
  {id:'heat-press-vinyl',name:'Heat Press Vinyl',method:'sqin',rate:0.0100,finishGroup:'print',active:true,demo:true},
  {id:'printed-poster',name:'Printed Poster',method:'sqin',rate:0.0060,finishGroup:'print',active:true,demo:true},
  {id:'large-format',name:'Large Format Print',method:'sqin',rate:0.0075,finishGroup:'print',active:true,demo:true},
  {id:'canvas-print',name:'Canvas Print',method:'sqin',rate:0.0120,finishGroup:'print',active:true,demo:true},
  {id:'box-material',name:'Box Material',method:'sqin',rate:0.0040,finishGroup:'sheet',active:true,demo:true},
  {id:'stained-glass',name:'Stained Glass',method:'sqin',rate:0.0300,finishGroup:'none',active:true,demo:true},
  {id:'laser-engrave',name:'Laser Engrave',method:'sqin',rate:0.0060,finishGroup:'none',active:true,demo:true},
  {id:'spray-paint',name:'Spray Paint',method:'sqin',rate:0.0030,finishGroup:'none',active:true,demo:true},
  {id:'polyurethane',name:'Polyurethane (wood)',method:'sqin',rate:0.0030,finishGroup:'none',active:true,demo:true},
  {id:'torch-flame',name:'Torch Flame',method:'sqin',rate:0.0060,finishGroup:'none',active:true,demo:true},
  {id:'powder-coat',name:'Powder Coat',method:'sqin',rate:0.0060,finishGroup:'none',active:true,demo:true},
  {id:'translucent-powder',name:'Translucent Powder Coat',method:'sqin',rate:0.0060,finishGroup:'none',active:true,demo:true}
];

const defaultTiers=[
  {max:36,total:3},{max:144,total:6},{max:288,total:9},{max:576,total:14},
  {max:864,total:20},{max:1296,total:28},{max:1728,total:36},{max:2304,total:46}
];

const finishChoices={
  none:['No finish'],
  wood:['No finish','Spray Paint','Polyurethane (wood)','Torch Flame'],
  sheet:['No finish','Spray Paint'],
  printed:['No finish','Spray Paint'],
  metal:['No finish','Powder Coat','Translucent Powder Coat','Spray Paint'],
  print:['No finish']
};

let pricing=deepCopy(defaultPricing);
let tiers=deepCopy(defaultTiers);
let currentId=null;
let pricingEditable=false;
let sharedPricingEmpty=true;
let sharedPricingMessage='Connecting to shared pricing…';

function $(id){return document.getElementById(id)}
function money(v){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)||0)}
function uid(){return (crypto.randomUUID?.()||('id-'+Date.now()+'-'+Math.random().toString(16).slice(2)))}
function deepCopy(x){return JSON.parse(JSON.stringify(x))}
function loadJson(key,fallback){try{return JSON.parse(localStorage.getItem(key))||deepCopy(fallback)}catch{return deepCopy(fallback)}}
function saveJson(key,val){localStorage.setItem(key,JSON.stringify(val))}
function setSelect(el,vals,includeBlank=false){el.innerHTML=(includeBlank?'<option value="">Select…</option>':'')+vals.map(v=>`<option>${escapeHtml(v)}</option>`).join('')}
function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||uid()}

function init(){
  setSelect($('affiliation'),options.affiliations,true);setSelect($('projectFor'),options.projectFor,true);setSelect($('paymentMethod'),options.payment,true);setSelect($('approval'),options.approval,true);setSelect($('tadHelp'),options.tadHelp,true);
  bindGlobal();newRequest();renderDashboard();renderPricing();
}

function bindGlobal(){
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $('addPartBtn').addEventListener('click',()=>addPart());$('saveBtn').addEventListener('click',saveRequest);$('newRequestBtn').addEventListener('click',newRequest);
  $('printBtn').addEventListener('click',()=>window.print());$('duplicateBtn').addEventListener('click',duplicateCurrent);
  $('discountRequested').addEventListener('change',conditionalFields);$('paymentMethod').addEventListener('change',conditionalFields);$('projectFor').addEventListener('change',conditionalFields);
  $('discountAmount').addEventListener('input',recalculate);$('tadHelp').addEventListener('change',recalculate);$('projectName').addEventListener('input',recalculate);
  ['requesterName','requesterEmail','affiliation','department','projectRecipient','approval','discountReason','studentHelper','draftDate','deliveryDate','otherDetails'].forEach(id=>$(id).addEventListener('input',()=>{}));
  $('exportCsvBtn').addEventListener('click',exportCsv);$('exportJsonBtn').addEventListener('click',exportJson);$('importJsonInput').addEventListener('change',importJson);
  $('addMaterialBtn').addEventListener('click',async()=>{
    if(!pricingEditable)return alert('Shared pricing is read-only for students. Sign in as authorized TAD staff to edit it.');
    const material={id:'material-'+Date.now(),name:'New material',method:'sqin',rate:0,finishGroup:'none',active:true,demo:false};
    try{
      await window.TADSharedPricingApi?.saveMaterial(material);
    }catch(error){
      console.error(error);
      alert('The material could not be added.');
    }
  });

  $('resetPricingBtn').addEventListener('click',async()=>{
    if(!pricingEditable)return alert('Shared pricing is read-only for students.');
    const label=sharedPricingEmpty?'publish the starter shared pricing':'replace all shared pricing with the starter values';
    if(!confirm(`Are you sure you want to ${label}?`))return;
    try{
      await window.TADSharedPricingApi?.publishDefaults();
    }catch(error){
      console.error(error);
      alert('Shared pricing could not be published.');
    }
  });
}

function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));$(name+'Tab').classList.add('active');
  if(name==='dashboard')renderDashboard();if(name==='pricing')renderPricing();
}

function conditionalFields(){
  $('discountReasonWrap').classList.toggle('hidden',$('discountRequested').value!=='Yes');
  $('approvalWrap').classList.toggle('hidden',$('paymentMethod').value!=='School Funds');
  const pf=$('projectFor').value;$('departmentWrap').classList.toggle('hidden',pf==='Personal Project'||pf==='');
}

function newRequest(){
  currentId=null;['requesterName','requesterEmail','projectName','department','projectRecipient','discountReason','studentHelper','draftDate','deliveryDate','otherDetails'].forEach(id=>$(id).value='');
  ['affiliation','projectFor','paymentMethod','approval','tadHelp'].forEach(id=>$(id).selectedIndex=0);$('discountRequested').value='No';$('discountAmount').value=0;
  $('partsContainer').innerHTML='';addPart();conditionalFields();recalculate();switchTab('request');
}

function addPart(data={}){
  const node=$('partTemplate').content.firstElementChild.cloneNode(true);$('partsContainer').appendChild(node);
  setSelect(node.querySelector('.part-unit'),options.units,true);populateMaterialSelect(node.querySelector('.part-material'));
  node.querySelector('.part-name').value=data.name||'';node.querySelector('.part-qty').value=data.qty??1;node.querySelector('.part-unit').value=data.unit||'Inches';node.querySelector('.part-width').value=data.width??'';node.querySelector('.part-length').value=data.length??'';node.querySelector('.part-amount').value=data.amount??'';node.querySelector('.part-material').value=data.materialId||'';node.querySelector('.part-yield').value=data.yield??1;
  node.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{if(el.classList.contains('part-unit'))updateUnitFields(node);if(el.classList.contains('part-material'))updateFinishOptions(node);recalculate();}));
  node.querySelector('.part-unit').addEventListener('change',()=>{updateUnitFields(node);recalculate();});node.querySelector('.part-material').addEventListener('change',()=>{updateFinishOptions(node);recalculate();});
  node.querySelector('.remove-part').addEventListener('click',()=>{if(document.querySelectorAll('.part-card').length>1){node.remove();renumberParts();recalculate();}});
  updateUnitFields(node);updateFinishOptions(node,data.finish||'No finish');renumberParts();recalculate();
}

function populateMaterialSelect(sel){
  const active=pricing.filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name));sel.innerHTML='<option value="">Select material…</option>'+active.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}
function renumberParts(){document.querySelectorAll('.part-card').forEach((p,i)=>p.querySelector('.part-number').textContent=i+1)}
function updateUnitFields(card){
  const unit=card.querySelector('.part-unit').value;const amount=card.querySelector('.amount-field');const dims=card.querySelectorAll('.dim');
  const special=unit==='Grams (3D Print)'||unit==='Each';dims.forEach(d=>d.classList.toggle('hidden',special));amount.classList.toggle('hidden',!special);
  amount.querySelector('span')?.remove();const label=amount;label.childNodes[0].nodeValue=unit==='Each'?'Items per copy':unit==='Grams (3D Print)'?'Grams per copy':'Amount';
  if(unit==='Each' && !card.querySelector('.part-amount').value)card.querySelector('.part-amount').value=1;
}
function updateFinishOptions(card,selected){
  const mat=pricing.find(p=>p.id===card.querySelector('.part-material').value);const vals=finishChoices[mat?.finishGroup||'none']||['No finish'];const sel=card.querySelector('.part-finish');const old=selected||sel.value;setSelect(sel,vals);sel.value=vals.includes(old)?old:'No finish';
}

function unitAmount(part,method){
  const qty=Math.max(0,Number(part.qty)||0);
  if(method==='gram') return (Number(part.amount)||0)*qty;
  if(method==='each') return (Number(part.amount)||1)*qty;
  const w=Number(part.width)||0,l=Number(part.length)||0;let factor=1;
  if(part.unit==='Feet')factor=144;else if(part.unit==='Yards')factor=1296;else if(part.unit==='Meters')factor=1550;else if(part.unit==='Millimeters')factor=.00155;else if(part.unit==='Inches')factor=1;
  return w*l*factor*qty;
}

function finishRate(name){const p=pricing.find(x=>x.name.toLowerCase()===String(name).toLowerCase());return p?.rate||0}
function sheetMetalCost(area,mat){
  const perCopyArea=area;for(const t of [...tiers].sort((a,b)=>a.max-b.max)){if(perCopyArea<=Number(t.max))return Number(t.total)||0}
  return perCopyArea*(Number(mat.rate)||0);
}

function calculatePart(p){
  const mat=pricing.find(x=>x.id===p.materialId);if(!mat)return {cost:0,base:0,finish:0,amount:0,note:'Select a material'};
  let amount=unitAmount(p,mat.method);let base=0;
  if(mat.method==='sheetMetalTier'){
    const qty=Math.max(0,Number(p.qty)||0);const single={...p,qty:1};const singleArea=unitAmount(single,'sqin');base=sheetMetalCost(singleArea,mat)*qty;amount=singleArea*qty;
  } else base=amount*(Number(mat.rate)||0);
  let fin=0;if(p.finish && p.finish!=='No finish'){
    // workbook applies finish over the same standardized amount. Torch flame and translucent powder were effectively 2x the spray-paint base in legacy formulas.
    const explicit=finishRate(p.finish);fin=amount*explicit;
  }
  const y=Math.max(.01,Number(p.yield)||1);const total=(base+fin)/y;
  const unitLabel=mat.method==='gram'?'g':mat.method==='each'?'items':'sq in';
  return {cost:total,base,finish:fin,amount,note:`${Math.round(amount*100)/100} ${unitLabel} × ${money(mat.rate)}${y!==1?` ÷ yield ${y}`:''}`};
}

function collectPart(card){return {name:card.querySelector('.part-name').value.trim(),qty:Number(card.querySelector('.part-qty').value)||0,unit:card.querySelector('.part-unit').value,width:Number(card.querySelector('.part-width').value)||0,length:Number(card.querySelector('.part-length').value)||0,amount:Number(card.querySelector('.part-amount').value)||0,materialId:card.querySelector('.part-material').value,finish:card.querySelector('.part-finish').value,yield:Number(card.querySelector('.part-yield').value)||1}}
function allParts(){return [...document.querySelectorAll('.part-card')].map(collectPart)}

function recalculate(){
  const parts=allParts();let materials=0;const summary=[];
  document.querySelectorAll('.part-card').forEach((card,i)=>{const p=collectPart(card),c=calculatePart(p);materials+=c.cost;card.querySelector('.part-cost').textContent=money(c.cost);card.querySelector('.calculation-note').textContent=c.note;summary.push({name:p.name||`Part ${i+1}`,cost:c.cost});});
  const tad=$('tadHelp').value==='Yes';const design=tad?materials:0;const discount=Math.max(0,Number($('discountAmount').value)||0);const total=Math.max(0,materials+design-discount);
  $('summaryProjectName').textContent=$('projectName').value.trim()||'Untitled project';$('summaryParts').innerHTML=summary.map(s=>`<div class="summary-item"><span>${escapeHtml(s.name)}</span><strong>${money(s.cost)}</strong></div>`).join('')||'<p class="hint">No parts yet.</p>';
  $('materialsTotal').textContent=money(materials);$('designTotal').textContent=money(design);$('discountTotal').textContent='−'+money(discount);$('grandTotal').textContent=money(total);return {materials,design,discount,total};
}

function collectRequest(){
  const totals=recalculate();return {id:currentId||uid(),createdAt:currentId?(findProject(currentId)?.createdAt||new Date().toISOString()):new Date().toISOString(),updatedAt:new Date().toISOString(),status:findProject(currentId)?.status||'Draft',requester:{name:$('requesterName').value.trim(),email:$('requesterEmail').value.trim(),affiliation:$('affiliation').value},project:{name:$('projectName').value.trim(),for:$('projectFor').value,department:$('department').value.trim(),recipient:$('projectRecipient').value.trim(),payment:$('paymentMethod').value,approval:$('approval').value,discountRequested:$('discountRequested').value,discountReason:$('discountReason').value.trim(),tadHelp:$('tadHelp').value,studentHelper:$('studentHelper').value.trim(),draftDate:$('draftDate').value,deliveryDate:$('deliveryDate').value,details:$('otherDetails').value.trim()},parts:allParts(),discountAmount:totals.discount,totals};
}
function findProject(id){return loadJson(STORAGE_KEY,[]).find(p=>p.id===id)}
function saveRequest(){
  const req=collectRequest();if(!req.project.name){alert('Please enter a project name before saving.');return}if(!req.requester.name){alert('Please enter the student / estimator name before saving.');return}
  const list=loadJson(STORAGE_KEY,[]);const ix=list.findIndex(x=>x.id===req.id);if(ix>=0)list[ix]=req;else list.unshift(req);saveJson(STORAGE_KEY,list);currentId=req.id;renderDashboard();alert('Estimate saved in this browser.');
}
function duplicateCurrent(){currentId=null;$('projectName').value=($('projectName').value||'Untitled')+' — Copy';recalculate()}
function loadRequest(id){const p=findProject(id);if(!p)return;currentId=id;$('requesterName').value=p.requester.name||'';$('requesterEmail').value=p.requester.email||'';$('affiliation').value=p.requester.affiliation||'';$('projectName').value=p.project.name||'';$('projectFor').value=p.project.for||'';$('department').value=p.project.department||'';$('projectRecipient').value=p.project.recipient||'';$('paymentMethod').value=p.project.payment||'';$('approval').value=p.project.approval||'';$('discountRequested').value=p.project.discountRequested||'No';$('discountReason').value=p.project.discountReason||'';$('tadHelp').value=p.project.tadHelp||'';$('studentHelper').value=p.project.studentHelper||'';$('draftDate').value=p.project.draftDate||'';$('deliveryDate').value=p.project.deliveryDate||'';$('otherDetails').value=p.project.details||'';$('discountAmount').value=p.discountAmount||0;$('partsContainer').innerHTML='';(p.parts?.length?p.parts:[{}]).forEach(addPart);conditionalFields();recalculate();switchTab('request')}

function renderDashboard(){
  const list=loadJson(STORAGE_KEY,[]);$('kpiRequests').textContent=list.length;$('kpiOpen').textContent=list.filter(p=>!['Finalized','Archived'].includes(p.status)).length;$('kpiCompleted').textContent=list.filter(p=>p.status==='Finalized').length;$('kpiValue').textContent=money(list.reduce((s,p)=>s+(Number(p.totals?.total)||0),0));
  $('projectsTable').innerHTML=list.length?list.map(p=>`<tr><td><strong>${escapeHtml(p.project?.name||'Untitled')}</strong></td><td>${escapeHtml(p.requester?.name||'')}</td><td>${escapeHtml(p.project?.department||'')}</td><td><select class="status-select" data-id="${p.id}">${['Draft','Budgeting','Finalized','Internal Exception','Archived'].map(s=>`<option ${p.status===s?'selected':''}>${s}</option>`).join('')}</select></td><td>${escapeHtml(p.project?.deliveryDate||'')}</td><td><strong>${money(p.totals?.total)}</strong></td><td><div class="row-actions"><button class="small-btn edit-project" data-id="${p.id}">Open</button><button class="small-btn delete-project" data-id="${p.id}">Delete</button></div></td></tr>`).join(''):'<tr><td colspan="7" class="hint">No saved estimates yet.</td></tr>';
  document.querySelectorAll('.edit-project').forEach(b=>b.onclick=()=>loadRequest(b.dataset.id));document.querySelectorAll('.delete-project').forEach(b=>b.onclick=()=>deleteProject(b.dataset.id));document.querySelectorAll('.status-select').forEach(s=>s.onchange=()=>setStatus(s.dataset.id,s.value));
}
function deleteProject(id){if(!confirm('Delete this saved estimate?'))return;saveJson(STORAGE_KEY,loadJson(STORAGE_KEY,[]).filter(p=>p.id!==id));renderDashboard()}
function setStatus(id,status){const list=loadJson(STORAGE_KEY,[]),p=list.find(x=>x.id===id);if(p){p.status=status;p.updatedAt=new Date().toISOString();saveJson(STORAGE_KEY,list);renderDashboard()}}

function refreshMaterialSelectors(){
  document.querySelectorAll('.part-material').forEach(sel=>{
    const old=sel.value;
    populateMaterialSelect(sel);
    sel.value=old;
  });
  recalculate();
}

async function saveSharedMaterial(material){
  if(!pricingEditable)return;
  try{
    await window.TADSharedPricingApi?.saveMaterial(material);
  }catch(error){
    console.error('[TAD Cost Estimator] Material save failed',error);
    alert('That shared pricing change could not be saved.');
  }
}

async function deleteSharedMaterial(material){
  if(!pricingEditable)return;
  if(!confirm(`Delete "${material.name}" from the shared material list?`))return;
  try{
    await window.TADSharedPricingApi?.removeMaterial(material.id);
  }catch(error){
    console.error('[TAD Cost Estimator] Material deletion failed',error);
    alert('That shared material could not be deleted.');
  }
}

async function saveSharedTiers(){
  if(!pricingEditable)return;
  try{
    await window.TADSharedPricingApi?.saveTiers(tiers);
  }catch(error){
    console.error('[TAD Cost Estimator] Tier save failed',error);
    alert('The shared sheet-metal tiers could not be saved.');
  }
}

function renderPricing(){
  const disabled=pricingEditable?'':' disabled';

  $('addMaterialBtn').disabled=!pricingEditable;
  $('resetPricingBtn').disabled=!pricingEditable;
  $('resetPricingBtn').textContent=sharedPricingEmpty
    ? 'Publish starter pricing'
    : 'Reset shared pricing';

  const status=$('sharedPricingStatus');
  if(status){
    status.innerHTML=pricingEditable
      ? `<strong>Shared pricing:</strong> ${escapeHtml(sharedPricingMessage)} Changes here are permanent and available to everyone.`
      : `<strong>Shared pricing:</strong> ${escapeHtml(sharedPricingMessage)} Students may use these prices but cannot alter the master list.`;
  }

  $('pricingTable').innerHTML=pricing.map((p,i)=>`<tr data-index="${i}">
    <td><input class="p-name" value="${escapeHtml(p.name)}"${disabled}></td>
    <td><select class="p-method"${disabled}>${
      [['sqin','Per sq. inch'],['gram','Per gram'],['each','Per each'],['sheetMetalTier','Sheet metal tiers']]
        .map(([v,l])=>`<option value="${v}" ${p.method===v?'selected':''}>${l}</option>`).join('')
    }</select></td>
    <td><input class="p-rate rate" type="number" min="0" step="0.0001" value="${p.rate}"${disabled}></td>
    <td><select class="p-finish"${disabled}>${
      ['none','wood','sheet','printed','metal','print']
        .map(v=>`<option ${p.finishGroup===v?'selected':''}>${v}</option>`).join('')
    }</select></td>
    <td><input class="p-active" type="checkbox" ${p.active?'checked':''}${disabled}></td>
    <td><button class="small-btn p-delete"${disabled}>Delete</button></td>
  </tr>`).join('');

  if(pricingEditable){
    document.querySelectorAll('#pricingTable tr').forEach(row=>{
      const i=Number(row.dataset.index);

      row.querySelectorAll('input,select').forEach(el=>{
        el.onchange=async()=>{
          pricing[i].name=row.querySelector('.p-name').value.trim();
          pricing[i].id=pricing[i].id||slug(pricing[i].name);
          pricing[i].method=row.querySelector('.p-method').value;
          pricing[i].rate=Number(row.querySelector('.p-rate').value)||0;
          pricing[i].finishGroup=row.querySelector('.p-finish').value;
          pricing[i].active=row.querySelector('.p-active').checked;
          pricing[i].demo=false;
          await saveSharedMaterial(pricing[i]);
        };
      });

      row.querySelector('.p-delete').onclick=()=>deleteSharedMaterial(pricing[i]);
    });
  }

  $('tierEditor').innerHTML=tiers.map((t,i)=>`
    <div class="tier-row">
      <label>Maximum sq. in.
        <input class="tier-max" data-i="${i}" type="number" value="${t.max}"${disabled}>
      </label>
      <label>Fixed total
        <input class="tier-total" data-i="${i}" type="number" step="0.01" value="${t.total}"${disabled}>
      </label>
    </div>`).join('');

  if(pricingEditable){
    document.querySelectorAll('.tier-max,.tier-total').forEach(el=>{
      el.onchange=async()=>{
        const i=Number(el.dataset.i);
        tiers[i].max=Number(document.querySelector(`.tier-max[data-i="${i}"]`).value)||0;
        tiers[i].total=Number(document.querySelector(`.tier-total[data-i="${i}"]`).value)||0;
        await saveSharedTiers();
        recalculate();
      };
    });
  }
}

window.TADSharedPricingUI={
  defaultPricing:()=>deepCopy(defaultPricing),
  defaultTiers:()=>deepCopy(defaultTiers),

  applyPricing:(next,empty=false)=>{
    pricing=deepCopy(next);
    sharedPricingEmpty=!!empty;
    renderPricing();
    refreshMaterialSelectors();
  },

  applyTiers:(next)=>{
    tiers=deepCopy(next);
    renderPricing();
    recalculate();
  },

  setAccess:({canEdit=false,email='',materialsEmpty=false,message=''})=>{
    pricingEditable=!!canEdit;
    sharedPricingEmpty=!!materialsEmpty;
    sharedPricingMessage=message||(
      pricingEditable
        ? `Editing enabled for ${email}.`
        : 'Shared pricing is read-only.'
    );
    renderPricing();
  }
};

function exportCsv(){
  const list=loadJson(STORAGE_KEY,[]),rows=[['Project','Estimator','Email','Affiliation','Department','Status','Delivery Date','Materials','Design','Discount','Total','Parts']];list.forEach(p=>rows.push([p.project?.name,p.requester?.name,p.requester?.email,p.requester?.affiliation,p.project?.department,p.status,p.project?.deliveryDate,p.totals?.materials,p.totals?.design,p.totals?.discount,p.totals?.total,p.parts?.length||0]));download('tad-projects.csv',rows.map(r=>r.map(csvCell).join(',')).join('\n'),'text/csv')
}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}
function exportJson(){download('tad-costing-backup.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),projects:loadJson(STORAGE_KEY,[]),pricing,tiers},null,2),'application/json')}
function importJson(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(Array.isArray(d.projects))saveJson(STORAGE_KEY,d.projects);renderDashboard();alert('Private project estimates restored. Shared material pricing was not changed.')}catch{alert('That file could not be read as a TAD Cost Estimator backup.')}};r.readAsText(f);e.target.value=''}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}

init();
