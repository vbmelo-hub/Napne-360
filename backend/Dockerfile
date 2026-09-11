FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml mvnw mvnw.cmd ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw -B -ntp dependency:go-offline
COPY src src
RUN ./mvnw -B -ntp clean verify

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S napne && adduser -S napne -G napne && apk add --no-cache wget
COPY --from=build /app/target/*.jar app.jar
RUN mkdir -p /data/uploads && chown -R napne:napne /data
USER napne
EXPOSE 9000
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
