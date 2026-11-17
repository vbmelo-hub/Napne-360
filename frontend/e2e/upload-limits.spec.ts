import { expect, test } from '@playwright/test';

test('upload aceita arquivo de 10 MiB e recusa acima do limite', async ({ request }) => {
  const login = await request.post('/api/v1/auth/login', {
    data: { email: 'napne@napne.local', password: 'Napne360!Demo' }
  });
  expect(login.status()).toBe(200);
  const session = await login.json();
  const headers = { Authorization: `Bearer ${session.token}` };
  const courses = await (await request.get('/api/v1/catalog/courses', { headers })).json();
  const studentResponse = await request.post('/api/v1/students', { headers, data: {
    courseId: courses[0].id, registration: `TEST-UPLOAD-${Date.now()}`,
    civilName: 'Pessoa Fictícia', socialName: 'Teste de limite de arquivo'
  } });
  expect(studentResponse.status()).toBe(200);
  const student = await studentResponse.json();
  const path = `/api/v1/students/${student.id}/attachments`;
  const mib = 1024 * 1024;
  for (const size of [512 * 1024, 2 * mib, 10 * mib, 10 * mib + 1, 11 * mib]) {
    const buffer = Buffer.alloc(size, 32);
    buffer.write('%PDF-1.7\n');
    const response = await request.post(`${path}?category=TESTE_FICTICIO`, {
      headers, multipart: { file: { name: 'ficticio.pdf', mimeType: 'application/pdf', buffer } }
    });
    expect(response.status(), `file=${size}: ${(await response.text()).slice(0, 300)}`).toBe(size <= 10 * mib ? 200 : 413);
    if (size <= 10 * mib) {
      const metadata = await response.json();
      expect(metadata.size).toBe(size);
      const downloaded = await request.get(`${path}/${metadata.id}/content`, { headers });
      expect(downloaded.status()).toBe(200);
      expect(await downloaded.body()).toEqual(buffer);
    }
  }
  const attachments = await (await request.get(path, { headers })).json();
  expect(attachments).toHaveLength(3);
});
