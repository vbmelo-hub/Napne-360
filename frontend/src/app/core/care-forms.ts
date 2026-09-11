export interface CareField { key: string; label: string; }
export const DOSSIER_FIELDS: Record<string, CareField[]> = {
  identification: [
    {key:'demand',label:'Demanda e origem do encaminhamento'},
    {key:'preferredCommunication',label:'Forma de comunicação preferida'},
    {key:'contacts',label:'Contatos e responsáveis'},
    {key:'courseChoice',label:'Escolha do curso e expectativas'}
  ],
  educationalNeeds: [
    {key:'category',label:'Categorias de necessidades educacionais'},
    {key:'specificNeeds',label:'Necessidades de apoio e acessibilidade'},
    {key:'documents',label:'Documentos apresentados'}
  ],
  healthAndSupport: [
    {key:'comorbidities',label:'Comorbidades relevantes ao atendimento'},
    {key:'medication',label:'Medicação contínua informada'},
    {key:'supportServices',label:'Serviços de apoio e profissionais de referência'}
  ],
  familyContext: [
    {key:'context',label:'Contexto familiar'},
    {key:'participation',label:'Participação familiar'},
    {key:'autonomy',label:'História e autonomia funcional'}
  ],
  schoolHistory: [
    {key:'history',label:'História escolar'},
    {key:'previousExperiences',label:'Experiências e adaptações anteriores'}
  ],
  strengths: [{key:'learning',label:'Potencialidades e interesses'}],
  difficulties: [{key:'learning',label:'Dificuldades e barreiras observadas'}],
  initialInterventions: [
    {key:'methodological',label:'Adaptações e intervenções iniciais'},
    {key:'referrals',label:'Encaminhamentos'},
    {key:'followUp',label:'Acompanhamento combinado'},
    {key:'expectations',label:'Expectativas do estudante'},
    {key:'observations',label:'Observações necessárias à finalidade do atendimento'}
  ]
};

export const RECORD_FIELDS: Record<string, CareField[]> = {
  INITIAL_SCREENING: [{key:'demand',label:'Demanda'}, {key:'needs',label:'Necessidades identificadas'}, {key:'referrals',label:'Encaminhamentos'}],
  WELCOMING: [{key:'studentPerspective',label:'Escuta do estudante'}, {key:'agreements',label:'Acordos de acompanhamento'}],
  CASE_STUDY: [
    {key:'sources',label:'Fontes consultadas e documentos analisados'},
    {key:'socioeconomicAnalysis',label:'Análise socioeconômica, se pertinente'},
    {key:'interviews',label:'Entrevistas realizadas'},
    {key:'homeVisit',label:'Visita domiciliar, se pertinente'},
    {key:'previousSchool',label:'Informações da escola anterior'},
    {key:'externalProfessionals',label:'Contribuições de profissionais externos'},
    {key:'findings',label:'Conclusões pedagógicas e próximos passos'}
  ],
  PEDAGOGICAL_GUIDANCE: [{key:'teachingNeeds',label:'Informações necessárias ao ensino'}, {key:'adaptations',label:'Adaptações sugeridas'}, {key:'napneSupport',label:'Apoio do NAPNE'}],
  ACTION_PLAN: [
    {key:'action',label:'Ação'}, {key:'methodology',label:'Descrição e metodologia'}, {key:'objective',label:'Objetivo'},
    {key:'audience',label:'Público-alvo'}, {key:'responsible',label:'Responsáveis'}, {key:'deadline',label:'Prazo'},
    {key:'expectedResult',label:'Resultado ou produto esperado'}, {key:'agreement',label:'Ciência e pactuação: participantes, data e manifestação'},
    {key:'actualResult',label:'Resultado alcançado'}
  ],
  TEACHER_FEEDBACK: [
    {key:'supportNeeded',label:'Necessidade de suporte'}, {key:'adaptations',label:'Adaptações realizadas'},
    {key:'socialCommunication',label:'Aspectos sociais e comunicacionais'}, {key:'performance',label:'Desempenho observado'},
    {key:'peiSituation',label:'Situação e aplicação do PEI'}
  ],
  TUTOR_OBSERVATION: [{key:'activity',label:'Atividade acompanhada'}, {key:'observations',label:'Observações'}, {key:'support',label:'Apoio prestado e encaminhamentos'}],
  SUPPORT_REFUSAL: [{key:'offeredSupport',label:'Apoio oferecido'}, {key:'studentStatement',label:'Manifestação do estudante'}, {key:'date',label:'Data e participantes'}],
  SUPPORT_REQUEST: [{key:'requestedSupport',label:'Apoio solicitado'}, {key:'studentStatement',label:'Manifestação do estudante'}, {key:'nextSteps',label:'Próximos passos'}]
};
