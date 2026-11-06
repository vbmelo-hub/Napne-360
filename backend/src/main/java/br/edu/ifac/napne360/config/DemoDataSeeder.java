package br.edu.ifac.napne360.config;

import br.edu.ifac.napne360.casework.*;
import br.edu.ifac.napne360.document.DossierDocument;
import br.edu.ifac.napne360.document.DossierRepository;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.student.*;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.Map;
import java.util.Set;

@Component
@ConditionalOnProperty(name = "napne360.seed.enabled", havingValue = "true")
@RequiredArgsConstructor
public class DemoDataSeeder implements CommandLineRunner {
    private final CampusRepository campuses;
    private final CourseRepository courses;
    private final SubjectRepository subjects;
    private final UserAccountRepository users;
    private final StudentRepository students;
    private final StudentAssignmentRepository assignments;
    private final NapneCaseRepository cases;
    private final DossierRepository dossiers;
    private final PasswordEncoder passwords;

    @Override
    public void run(String... args) {
        Campus campus = campuses.findByCode("RB").orElseGet(() -> campuses.save(
                Campus.builder().name("Campus Rio Branco (demonstração)").code("RB").build()));
        Course course = courses.findByCampusIdAndActiveTrueOrderByName(campus.getId()).stream().findFirst().orElseGet(() ->
                courses.save(Course.builder().campus(campus).name("Tecnologia em Sistemas para Internet").code("TSI").build()));
        Subject subject = subjects.findByCourseIdAndActiveTrueOrderByName(course.getId()).stream().findFirst().orElseGet(() ->
                subjects.save(Subject.builder().course(course).name("Desenvolvimento Web").code("DW01")
                        .workloadHours(60).syllabus("Fundamentos e práticas de desenvolvimento de aplicações web.").build()));

        UserAccount admin = user("Administrador de demonstração", "admin@napne.local", null, Set.of(RoleName.ADMIN));
        UserAccount napne = user("Equipe NAPNE", "napne@napne.local", campus, Set.of(RoleName.NAPNE));
        UserAccount teacher = user("Docente de demonstração", "professor@napne.local", campus, Set.of(RoleName.TEACHER));
        UserAccount cotep = user("COTEP de demonstração", "cotep@napne.local", campus, Set.of(RoleName.COTEP));
        UserAccount coordinator = user("Coordenação de demonstração", "coordenacao@napne.local", campus, Set.of(RoleName.COURSE_COORDINATOR));
        UserAccount management = user("Gestão de demonstração", "gestao@napne.local", campus, Set.of(RoleName.MANAGEMENT));
        UserAccount tutor = user("Tutor de demonstração", "tutor@napne.local", campus, Set.of(RoleName.TUTOR));

        Student student = students.findByRegistration("202600001").orElseGet(() -> students.save(Student.builder().campus(campus).course(course).registration("202600001")
                    .civilName("Estudante Exemplo").socialName("Alex Exemplo").birthDate(LocalDate.of(2005, 5, 12))
                    .institutionalEmail("alex.exemplo@example.invalid").phone("(68) 99999-0000").build()));
        if (cases.findByStudentIdOrderByOpenedAtDesc(student.getId()).isEmpty()) {
            cases.save(NapneCase.builder().student(student).source("Matrícula - dados fictícios").responsible(napne)
                    .stage(CaseStage.SCREENING).summary("Caso criado exclusivamente para demonstração.").build());
        }
        assign(student, teacher, subject, AssignmentType.TEACHER);
        assign(student, tutor, null, AssignmentType.TUTOR);
        assign(student, cotep, null, AssignmentType.COORDINATOR);
        assign(student, coordinator, null, AssignmentType.COORDINATOR);
        assign(student, management, null, AssignmentType.COORDINATOR);
        if (dossiers.findByStudentId(student.getId()).isEmpty()) {
            dossiers.save(DossierDocument.builder().studentId(student.getId())
                    .identification(Map.of("preferredCommunication", "Texto objetivo"))
                    .educationalNeeds(Map.of("category", "Dado fictício para demonstração"))
                    .strengths(Map.of("learning", "Boa resposta a exemplos visuais"))
                    .difficulties(Map.of("learning", "Necessita instruções segmentadas"))
                    .initialInterventions(Map.of("methodological", "Organizar tarefas em etapas curtas"))
                    .updatedBy(napne.getEmail()).build());
        }
    }

    private void assign(Student student, UserAccount user, Subject subject, AssignmentType type) {
        if (!assignments.existsByStudentIdAndUserIdAndActiveTrue(student.getId(),user.getId()))
            assignments.save(StudentAssignment.builder().student(student).user(user).subject(subject).assignmentType(type).build());
    }

    private UserAccount user(String name, String email, Campus campus, Set<RoleName> roles) {
        return users.findByEmailIgnoreCase(email).orElseGet(() -> users.save(UserAccount.builder().name(name).email(email)
                .passwordHash(passwords.encode("Napne360!Demo")).campus(campus).roles(roles).build()));
    }
}
