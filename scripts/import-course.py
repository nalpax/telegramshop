"""Reproduce the private server-side lesson data from the owner's PDF; requires PyMuPDF.
Not a runtime dependency. Original PDF remains the authoritative source.
"""
import fitz, json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=root/'handoff/course/Vibentry_Course_v02.pdf'
if not source.exists():
 raise SystemExit('Copy your original Vibentry_Course_v02.pdf to handoff/course/ first. This private file is deliberately excluded from GitHub.')
doc=fitz.open(source)
ranges=[(4,6),(7,8),(9,10),(11,12),(13,14),(15,16),(17,18),(19,20),(21,21),(22,23),(24,24),(25,26),(27,28),(29,30),(31,33),(34,35),(36,37),(38,39),(40,41),(42,43),(44,45),(46,47),(48,49),(50,51)]
def code_from_page(page):
 lines=[]
 for block in doc[page-1].get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   spans=line['spans']
   if spans and all(abs(s['size']-8.2)<0.15 for s in spans):
    lines.append(''.join(s['text'] for s in spans).strip())
 return '\n'.join(lines).strip()
resources={'notes':code_from_page(7),'first-prompt':code_from_page(9),'mobile-prompt':code_from_page(14)}
if not all(resources.values()):
 raise SystemExit('The PDF does not match v0.2. Review its template blocks before importing.')
(root/'data/resources.json').write_text(json.dumps(resources,ensure_ascii=False,indent=2))
lessons=[]
for idx,(first,last) in enumerate(ranges,1):
 groups=[]
 for pageidx in range(first-1,last):
  pending=None
  for block in doc[pageidx].get_text('dict')['blocks']:
   if 'lines' not in block:continue
   for line in block['lines']:
    spans=line['spans'];text=''.join(s['text'] for s in spans).strip()
    if not text:continue
    y0=min(s['bbox'][1] for s in spans);y1=max(s['bbox'][3] for s in spans)
    size=max(s['size'] for s in spans)
    if y0>790 or size>20 or text in ['БЕСПЛАТНЫЙ УРОК','ПЛАТНЫЙ УРОК'] or text=='→' or text.isdigit():continue
    # Body lines are 17px apart; paragraphs have larger gaps.
    category='heading' if size>=13 or text.isupper() else 'body'
    if pending and category==pending['kind']=='body' and y0-pending['y1']<10:
     pending['text']+=' '+text;pending['y1']=y1
    else:
     pending={'text':text,'kind':category,'y1':y1};groups.append(pending)
  # Do not merge body text across page boundaries.
 texts=[g['text'] for g in groups]
 outcome='Практический результат по теме урока.';task='Выполни практическое задание из урока.'
 if 'ЧТО ПОЛУЧИШЬ' in texts:
  n=texts.index('ЧТО ПОЛУЧИШЬ');outcome=groups[n+1]['text'];groups=groups[n+2:]
 sections=[];current={'title':'','paragraphs':[]};skip=False
 for n,g in enumerate(groups):
  t=g['text']
  if t=='СДЕЛАЙ СЕЙЧАС':
   if n+1<len(groups):task=groups[n+1]['text']
   skip=True;continue
  if skip:skip=False;continue
  if t.startswith('Дальше:') or t.startswith('Итог:'):continue
  if g['kind']=='heading':
   if current['paragraphs']:sections.append(current)
   current={'title':t.capitalize() if t.isupper() else t,'paragraphs':[]}
  else:current['paragraphs'].append(t)
 if current['paragraphs']:sections.append(current)
 if idx==3:sections.insert(1,{'title':'Пример задачи для агента','code':resources['first-prompt']})
 if idx==5:sections.insert(1,{'title':'Промпт для мобильной версии','code':resources['mobile-prompt']})
 lessons.append({'id':idx,'outcome':outcome,'sections':sections,'task':task,'confirmation':'Я выполнил практическое задание'})
(root/'data/lessons.json').write_text(json.dumps(lessons,ensure_ascii=False,indent=2))
(root/'data/free-lessons.json').write_text(json.dumps(lessons[:1],ensure_ascii=False,indent=2))
print('Imported 24 lessons from the author PDF. Only lesson 01 is free in this app.')
