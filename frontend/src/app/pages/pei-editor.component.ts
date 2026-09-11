import { Component, OnInit, signal, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Pei } from '../core/models';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <a [routerLink]="['/estudantes', studentId]" class="back">← Voltar ao acompanhamento</a>
    @if (pei(); as value) {
      <header class="page-head"><div><span class="eyebrow">PEI · {{ value.academicTerm }}</span><h1>Plano de Ensino Individualizado</h1><p>Revisão {{ value.revision }} · <span class="badge">{{ value.status }}</span></p></div></header>
      <div class="warning" role="note"><strong>Revisão humana obrigatória.</strong> Este rascunho apoia o planejamento e não substitui a análise do docente e da equipe responsável.</div>
      <form class="card stack" [formGroup]="form" (ngSubmit)="save()">
        <div class="grid two">
          <label>Objetivo geral<textarea formControlName="generalObjectives"></textarea></label>
          <label>Objetivos específicos — um por linha<textarea formControlName="specificObjectives"></textarea></label>
          <label>Objetivos não aplicáveis e justificativas<textarea formControlName="eliminatedObjectives"></textarea></label>
          <label>Objetivos alternativos<textarea formControlName="alternativeObjectives"></textarea></label>
          <label>Objetivos complementares<textarea formControlName="complementaryObjectives"></textarea></label>
          <label>Habilidades e competências profissionais<textarea formControlName="professionalSkills"></textarea></label>
          <label>Ementa<textarea formControlName="syllabus"></textarea></label>
          <label>Pré-requisitos<textarea formControlName="prerequisites"></textarea></label>
          <label>Conteúdos prioritários<textarea formControlName="contents"></textarea></label>
          <label>Estratégias facilitadoras<textarea formControlName="teachingStrategies"></textarea></label>
          <label>Recursos metodológicos e assistivos<textarea formControlName="methodologicalResources"></textarea></label>
          <label>Critérios de avaliação<textarea formControlName="assessmentCriteria"></textarea></label>
          <label>Instrumentos de avaliação<textarea formControlName="assessmentInstruments"></textarea></label>
          <label>Recuperação diferenciada<textarea formControlName="recoveryProposal"></textarea></label>
          <label>Bibliografia básica<textarea formControlName="basicBibliography"></textarea></label>
          <label>Bibliografia complementar<textarea formControlName="complementaryBibliography"></textarea></label>
        </div>
        <fieldset><legend>Inventário de habilidades e competências</legend><p class="muted">Selecione a observação registrada em cada dimensão.</p>
          <div class="grid two">@for(dimension of dimensions; track dimension.key) { <label>{{dimension.label}}<select [formControlName]="dimension.key"><option value="REALIZA_COM_AJUDA">Realiza com ajuda</option><option value="REALIZA_SEM_AJUDA">Realiza sem ajuda</option><option value="NAO_REALIZA">Não realiza</option><option value="NAO_OBSERVADO">Não foi observado</option></select></label> }</div>
        </fieldset>
        @if (message()) { <div [class]="messageClass()" role="status">{{ message() }}</div> }
        <div class="row"><button type="submit" [disabled]="saving() || value.status === 'ARCHIVED' || value.status === 'SUPERSEDED'">Salvar como nova revisão</button><button type="button" class="secondary" (click)="approve()" [disabled]="saving() || value.status === 'APPROVED' || value.status === 'ARCHIVED' || value.status === 'SUPERSEDED'">Aprovar após revisão</button></div>
      </form>
    } @else { <p>Carregando PEI…</p> }
  `,
  styles: [`
    .back { display:inline-block;color:var(--primary);margin-bottom:1rem}.page-head{margin-bottom:1rem}.page-head h1{margin:.2rem 0;font-size:2.4rem}.eyebrow{color:var(--primary);font-weight:800;text-transform:uppercase;letter-spacing:.06em}.warning{background:#fff7df;border-left:5px solid var(--accent);padding:1rem;margin-bottom:1rem}fieldset{border:1px solid var(--border);border-radius:.7rem;padding:1rem}legend{font-weight:800;padding:0 .5rem}
  `]
})
export class PeiEditorComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  private router = inject(Router);

  readonly dimensions=[{key:'oralCommunication',label:'Comunicação oral'},{key:'readingAndWriting',label:'Leitura e produção textual'},{key:'logicalMathematicalReasoning',label:'Raciocínio lógico-matemático'},{key:'socioemotionalSkills',label:'Habilidades socioemocionais'},{key:'functionalAutonomy',label:'Autonomia funcional'},{key:'digitalTechnologies',label:'Tecnologias digitais'}];
  readonly studentId = Number(this.route.snapshot.paramMap.get('studentId'));
  peiId = String(this.route.snapshot.paramMap.get('peiId'));
  readonly pei = signal<Pei | null>(null); readonly saving = signal(false); readonly message = signal(''); readonly messageClass = signal('success');
  readonly form = this.fb.nonNullable.group({
    generalObjectives:['',Validators.required], specificObjectives:[''], eliminatedObjectives:[''], alternativeObjectives:[''], complementaryObjectives:[''], professionalSkills:[''], syllabus:[''], prerequisites:[''], contents:[''], teachingStrategies:[''], methodologicalResources:[''], assessmentCriteria:[''], assessmentInstruments:[''], recoveryProposal:[''], basicBibliography:[''], complementaryBibliography:[''], oralCommunication:[''], readingAndWriting:[''], logicalMathematicalReasoning:[''], socioemotionalSkills:[''], functionalAutonomy:[''], digitalTechnologies:['']
  });
  private rawContent: Record<string,unknown> = {};
  ngOnInit(): void { this.route.paramMap.subscribe(params=>{this.peiId=String(params.get('peiId'));this.api.pei(this.studentId,this.peiId).subscribe({next:p=>{this.pei.set(p);this.rawContent=p.content;this.fill(p.content);this.form.markAsPristine();},error:()=>this.fail()});}); }
  save(): void { this.saving.set(true);this.api.revisePei(this.studentId,this.peiId,{status:this.form.valid?'IN_REVIEW':'DRAFT',content:this.content()}).subscribe({next:p=>{this.saving.set(false);this.pei.set(p);this.rawContent=p.content;this.form.markAsPristine();void this.router.navigate(['/estudantes',this.studentId,'pei',p.id]);this.ok('Nova revisão salva.');},error:()=>{this.saving.set(false);this.fail();}}); }
  approve(): void { if(this.form.dirty){this.messageClass.set('error');this.message.set('Salve as alterações antes de aprovar a revisão.');return;}this.saving.set(true);this.api.approvePei(this.studentId,this.peiId).subscribe({next:p=>{this.pei.set(p);this.saving.set(false);this.ok('PEI aprovado e revisão humana registrada.');},error:()=>{this.saving.set(false);this.fail();}}); }
  private content():Record<string,unknown>{const v=this.form.getRawValue();const lines=(s:string)=>s.split('\n').map(x=>x.trim()).filter(Boolean);return{...this.rawContent,generalObjectives:v.generalObjectives,specificObjectives:lines(v.specificObjectives),eliminatedObjectives:lines(v.eliminatedObjectives),alternativeObjectives:lines(v.alternativeObjectives),complementaryObjectives:lines(v.complementaryObjectives),professionalSkills:lines(v.professionalSkills),syllabus:v.syllabus,prerequisites:v.prerequisites,contents:lines(v.contents),teachingStrategies:lines(v.teachingStrategies),methodologicalResources:lines(v.methodologicalResources),assessmentCriteria:lines(v.assessmentCriteria),assessmentInstruments:lines(v.assessmentInstruments),recoveryProposal:v.recoveryProposal,basicBibliography:lines(v.basicBibliography),complementaryBibliography:lines(v.complementaryBibliography),skillsInventory:{oralCommunication:v.oralCommunication,readingAndWriting:v.readingAndWriting,logicalMathematicalReasoning:v.logicalMathematicalReasoning,socioemotionalSkills:v.socioemotionalSkills,functionalAutonomy:v.functionalAutonomy,digitalTechnologies:v.digitalTechnologies}};}
  private fill(c:Record<string,unknown>):void{const text=(key:string)=>Array.isArray(c[key])?(c[key] as unknown[]).join('\n'):typeof c[key]==='object'?JSON.stringify(c[key],null,2):String(c[key]??'');const inventory=(c['skillsInventory']??{}) as Record<string,unknown>;this.form.patchValue({generalObjectives:text('generalObjectives'),specificObjectives:text('specificObjectives'),eliminatedObjectives:text('eliminatedObjectives'),alternativeObjectives:text('alternativeObjectives'),complementaryObjectives:text('complementaryObjectives'),professionalSkills:text('professionalSkills'),syllabus:text('syllabus'),prerequisites:text('prerequisites'),contents:text('contents'),teachingStrategies:text('teachingStrategies'),methodologicalResources:text('methodologicalResources'),assessmentCriteria:text('assessmentCriteria'),assessmentInstruments:text('assessmentInstruments'),recoveryProposal:text('recoveryProposal'),basicBibliography:text('basicBibliography'),complementaryBibliography:text('complementaryBibliography'),oralCommunication:this.join(inventory['oralCommunication']),readingAndWriting:this.join(inventory['readingAndWriting']),logicalMathematicalReasoning:this.join(inventory['logicalMathematicalReasoning']),socioemotionalSkills:this.join(inventory['socioemotionalSkills']),functionalAutonomy:this.join(inventory['functionalAutonomy']),digitalTechnologies:this.join(inventory['digitalTechnologies'])});}
  private join(v:unknown):string{return typeof v==='string'?v:'NAO_OBSERVADO'} private ok(v:string):void{this.messageClass.set('success');this.message.set(v)} private fail():void{this.messageClass.set('error');this.message.set('Não foi possível concluir a operação. Confira o preenchimento e o docente responsável.')}
}
