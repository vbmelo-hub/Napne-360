import { test, expect } from '@playwright/test';

test('caso completo: dossiê, acompanhamento, PEI e negação de acesso',async({request})=>{
  const login=async(email:string)=>{
    const response=await request.post('/api/v1/auth/login',{data:{email,password:'Napne360!Demo'}});
    expect(response.status()).toBe(200);
    return response.json();
  };
  const napne=await login('napne@napne.local');
  const admin=await login('admin@napne.local');
  const teacher=await login('professor@napne.local');
  const headers={Authorization:`Bearer ${napne.token}`};
  const adminHeaders={Authorization:`Bearer ${admin.token}`};
  const teacherHeaders={Authorization:`Bearer ${teacher.token}`};
  const post=async(path:string,data:object,customHeaders=headers)=>{
    const response=await request.post('/api/v1'+path,{headers:customHeaders,data});
    expect(response.status(),`${path}: ${await response.text()}`).toBeLessThan(300);
    return response.json();
  };
  const courses=await (await request.get('/api/v1/catalog/courses',{headers})).json();
  const subjects=await (await request.get('/api/v1/catalog/subjects',{headers,params:{courseId:courses[0].id}})).json();
  const student=await post('/students',{courseId:courses[0].id,registration:`TEST-${Date.now()}`,civilName:'Pessoa Fictícia',socialName:'Exemplo de Teste'});
  const studentPath=`/students/${student.id}`;
  expect((await request.get('/api/v1'+studentPath,{headers:teacherHeaders})).status()).toBe(403);
  expect((await request.get('/api/v1'+studentPath+'/dossier',{headers:adminHeaders})).status()).toBe(403);
  await post('/admin/assignments',{studentId:student.id,userId:teacher.id,subjectId:subjects[0].id,assignmentType:'TEACHER'},adminHeaders);
  const caseValue=await post(studentPath+'/cases',{source:'Teste automatizado',summary:'Caso fictício'});
  const initial=await (await request.get('/api/v1'+studentPath+'/dossier',{headers})).json();
  const updated=await request.put('/api/v1'+studentPath+'/dossier',{headers,data:{...initial,identification:{demand:'Acompanhamento fictício'},strengths:{learning:'Exemplos visuais'}}});
  expect(updated.status()).toBe(200);
  for(const type of ['INITIAL_SCREENING','CASE_STUDY','PEDAGOGICAL_GUIDANCE','ACTION_PLAN'])
    await post(studentPath+'/records',{caseId:caseValue.id,type,title:`Teste ${type}`,status:'ACTIVE',content:{notes:'Conteúdo fictício'}});
  await post(studentPath+'/records',{type:'TEACHER_FEEDBACK',subjectId:subjects[0].id,title:'Devolutiva de teste',status:'ACTIVE',content:{performance:'Atividade concluída'}},teacherHeaders);
  const draft=await post(studentPath+'/peis',{subjectId:subjects[0].id,teacherId:teacher.id,academicTerm:'2026.TEST'},teacherHeaders);
  const bypass=await request.put('/api/v1'+studentPath+`/peis/${draft.id}`,{headers:teacherHeaders,data:{status:'APPROVED',content:draft.content}});
  expect(bypass.status()).toBe(400);
  const content={...draft.content,generalObjectives:'Objetivo fictício',specificObjectives:['Objetivo específico'],contents:['Conteúdo'],teachingStrategies:['Exemplos'],assessmentCriteria:['Participação'],assessmentInstruments:['Atividade']};
  const revised=await request.put('/api/v1'+studentPath+`/peis/${draft.id}`,{headers:teacherHeaders,data:{status:'IN_REVIEW',content}});
  expect(revised.status()).toBe(200);
  const version=await revised.json();
  const approved=await post(studentPath+`/peis/${version.id}/approve`,{},teacherHeaders);
  expect(approved.status).toBe('APPROVED');
  expect(approved.reviewedBy).toBe(teacher.email);
  const redacted=await (await request.get('/api/v1'+studentPath+'/dossier',{headers:teacherHeaders})).json();
  expect(redacted.redacted).toBe(true);
  expect(redacted.identification).toEqual({});
  const upload=await request.post('/api/v1'+studentPath+'/attachments?category=ORIENTACAO_PEDAGOGICA',{headers,multipart:{
    file:{name:'orientacao-teste.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% arquivo ficticio de teste\n%%EOF')}
  }});
  expect(upload.status(),await upload.text()).toBe(200);
  const attachment=await upload.json();
  expect(attachment.revision).toBe(1);
  const download=await request.get('/api/v1'+studentPath+`/attachments/${attachment.id}/content`,{headers});
  expect(download.status()).toBe(200);
  expect((await download.body()).toString()).toContain('%PDF-1.4');
  expect((await request.get('/api/v1'+studentPath+`/attachments/${attachment.id}/content`,{headers:teacherHeaders})).status()).toBe(403);
  const versionUpload=await request.post('/api/v1'+studentPath+`/attachments?category=ORIENTACAO_PEDAGOGICA&previousVersionId=${attachment.id}`,{headers,multipart:{
    file:{name:'orientacao-teste-v2.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% segunda versao ficticia\n%%EOF')}
  }});
  expect(versionUpload.status(),await versionUpload.text()).toBe(200);
  expect((await versionUpload.json()).revision).toBe(2);
  const documentTimeline=await (await request.get('/api/v1'+studentPath+'/timeline',{headers,params:{type:'ATTACHMENT'}})).json();
  expect(documentTimeline.length).toBeGreaterThanOrEqual(2);
  await request.post('/api/v1/auth/logout',{headers:teacherHeaders});
  expect((await request.get('/api/v1/auth/me',{headers:teacherHeaders})).status()).toBe(401);
});
