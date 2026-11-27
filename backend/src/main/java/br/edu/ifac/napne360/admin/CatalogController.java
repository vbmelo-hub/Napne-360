package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.security.CurrentUserService;
import lombok.RequiredArgsConstructor;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/catalog")
@RequiredArgsConstructor
public class CatalogController {
    private final CampusRepository campuses;
    private final CourseRepository courses;
    private final SubjectRepository subjects;
    private final CurrentUserService currentUser;
    private final br.edu.ifac.napne360.security.AccessGuard access;
    private final br.edu.ifac.napne360.student.StudentAssignmentRepository assignments;

    @GetMapping("/student-subjects")
    @Transactional(readOnly = true)
    public List<AdminController.SubjectView> studentSubjects(@RequestParam Long studentId) {
        var student = access.requireView(studentId);
        return subjects.findByCourseIdAndActiveTrueOrderByName(student.getCourse().getId()).stream()
                .filter(s -> access.canViewSubject(studentId, s.getId()))
                .map(AdminController.SubjectView::of).toList();
    }

    @GetMapping("/student-teachers")
    @Transactional(readOnly = true)
    public List<TeacherView> studentTeachers(@RequestParam Long studentId) {
        access.requireView(studentId);
        return assignments.findByStudentIdAndActiveTrue(studentId).stream()
                .filter(a -> a.getAssignmentType() == br.edu.ifac.napne360.student.AssignmentType.TEACHER)
                .filter(a -> a.getSubject() != null && a.getUser().isActive() && a.getUser().getRoles().contains(RoleName.TEACHER))
                .filter(a -> access.canViewSubject(studentId, a.getSubject().getId()))
                .map(a -> new TeacherView(a.getUser().getId(), a.getUser().getName(), a.getSubject().getId())).distinct().toList();
    }

    public record TeacherView(Long id, String name, Long subjectId) {}

    @GetMapping("/campuses")
    public List<AdminCampusController.CampusView> campuses() {
        return campuses.findAll().stream().filter(Campus::isActive)
                .map(AdminCampusController.CampusView::of).toList();
    }

    @GetMapping("/courses")
    @Transactional(readOnly = true)
    public List<AdminController.CourseView> courses() {
        UserAccount user = currentUser.require();
        if (user.getCampus() == null) return List.of();
        return courses.findByCampusIdAndActiveTrueOrderByName(user.getCampus().getId()).stream()
                .map(AdminController.CourseView::of).toList();
    }

    @GetMapping("/subjects")
    @Transactional(readOnly = true)
    public List<AdminController.SubjectView> subjects(@RequestParam Long courseId) {
        return subjects.findByCourseIdAndActiveTrueOrderByName(courseId).stream()
                .map(AdminController.SubjectView::of).toList();
    }
}
