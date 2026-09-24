// Drive the new logic against an in-memory stand-in for the two tables it touches.
// Proves the arithmetic without writing to production.
const n=(v:number)=>v.toLocaleString('en-US',{maximumFractionDigits:2})
let fail=0
const t=(name:string,ok:boolean,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${name}${d?'  — '+d:''}`); if(!ok)fail++}

type Batch={id:string;bn:string;lot:string;loc:string;kg:number;sacks:number;pk:number;src?:string}
function world(){return [
  {id:'p1',bn:'PC-031',lot:'robusta',loc:'PACO',kg:18900,sacks:315,pk:60},
  {id:'b1',bn:'PC-031-CFX',lot:'robusta',loc:'BTK',kg:105,sacks:105,pk:1},
] as Batch[]}

function transferBetween(bs:Batch[],lot:string,from:string,to:string,kg:number,led:any[]){
  let rem=kg
  for(const b of bs.filter(x=>x.lot===lot&&x.loc===from&&x.kg>0).slice()){
    if(rem<=0.0001) break
    const move=Math.min(rem,b.kg), pk=b.pk||1
    if(move>=b.kg-0.005){ b.loc=to
      led.push({b:b.id,t:'transfer_out',kg:-move},{b:b.id,t:'transfer_in',kg:move}) }
    else{ const child:Batch={id:b.id+'-T',bn:`${b.bn}-T01`,lot:b.lot,loc:to,kg:move,sacks:Math.round(move/pk),pk,src:b.id}
      bs.push(child); b.kg=b.kg-move; b.sacks=Math.round(b.kg/pk)
      led.push({b:b.id,t:'transfer_out',kg:-move},{b:child.id,t:'transfer_in',kg:move}) }
    rem-=move }
  return rem<=0.0001
}
function dispatch(bs:Batch[],lot:string,sourced:string,picked:string,kg:number,led:any[]){
  if(picked!==sourced) if(!transferBetween(bs,lot,sourced,picked,kg,led)) return false
  let rem=kg
  for(const b of bs.filter(x=>x.lot===lot&&x.loc===picked&&x.kg>0)){
    if(rem<=0) break
    const d=Math.min(rem,b.kg), pk=b.pk||1
    b.kg-=d; b.sacks=Math.round(b.kg/pk)
    led.push({b:b.id,t:'dispatch',kg:-d}); rem-=d }
  return rem<=0.0001
}
const at=(bs:Batch[],lot:string,loc:string)=>bs.filter(b=>b.lot===lot&&b.loc===loc).reduce((s,b)=>s+b.kg,0)

console.log('DR 1884 replayed: 120 kg Robusta, sourced Paco, picked Bagtikan\n')
{ const bs=world(), led:any[]=[]
  // Bagtikan cannot cover 120 from its 105 kg of 1kg bags, so the transfer must supply it
  dispatch(bs,'robusta','PACO','BTK',120,led)
  t('Paco debited exactly once',  Math.abs(at(bs,'robusta','PACO')-18780)<0.005, `${n(at(bs,'robusta','PACO'))} (was 18,900)`)
  t('Bagtikan ends where it started', Math.abs(at(bs,'robusta','BTK')-105)<0.005, `${n(at(bs,'robusta','BTK'))}`)
  t('one transfer pair written', led.filter(x=>x.t.startsWith('transfer')).length===2)
  t('transfer nets to zero', Math.abs(led.filter(x=>x.t.startsWith('transfer')).reduce((s,x)=>s+x.kg,0))<0.005)
  t('dispatch rows total −120', Math.abs(led.filter(x=>x.t==='dispatch').reduce((s,x)=>s+x.kg,0)+120)<0.005)
  t('ledger balances against the move', Math.abs(led.reduce((s,x)=>s+x.kg,0)+120)<0.005)
  t('NOT the old outcome (Paco −120 AND stock stranded at Bagtikan)', at(bs,'robusta','BTK')===105) }

console.log('\nSame product, picked where it was sourced — nothing should move between sites')
{ const bs=world(), led:any[]=[]
  dispatch(bs,'robusta','PACO','PACO',120,led)
  t('no transfer written', led.filter(x=>x.t.startsWith('transfer')).length===0)
  t('Paco 18,900 → 18,780', Math.abs(at(bs,'robusta','PACO')-18780)<0.005)
  t('Bagtikan untouched', at(bs,'robusta','BTK')===105) }

console.log('\nSacks follow the weight (the stale-sack trap)')
{ const bs=world(), led:any[]=[]
  dispatch(bs,'robusta','BTK','BTK',105,led)
  const b=bs.find(x=>x.id==='b1')!
  t('emptied batch reports 0 sacks, not a stale count', b.kg===0&&b.sacks===0, `${b.kg} kg / ${b.sacks} sk`) }

console.log('\nPartial split keeps both sides whole')
{ const bs=world(), led:any[]=[]
  transferBetween(bs,'robusta','PACO','BTK',180,led)
  t('Paco 18,900 → 18,720', Math.abs(at(bs,'robusta','PACO')-18720)<0.005, n(at(bs,'robusta','PACO')))
  t('Bagtikan 105 → 285',   Math.abs(at(bs,'robusta','BTK')-285)<0.005, n(at(bs,'robusta','BTK')))
  t('total conserved',      Math.abs(at(bs,'robusta','PACO')+at(bs,'robusta','BTK')-19005)<0.005)
  const p=bs.find(x=>x.id==='p1')!
  t('parent sacks recomputed', p.sacks===312, `${p.sacks}`) }

console.log(`\n${fail===0?'all checks passed':fail+' FAILED'}`)
process.exit(fail?1:0)
