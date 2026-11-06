package br.edu.ifac.napne360.identity;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CourseRepository extends JpaRepository<Course, Long> {
    List<Course> findByCampusIdAndActiveTrueOrderByName(Long campusId);
}
