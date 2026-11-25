package br.edu.ifac.napne360.pei;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lowagie.text.Chunk;
import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import org.librepdf.openpdf.fonts.Liberation;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Component
public class PeiPdfRenderer {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode FORM = JSON.valueToTree(PeiAnnexI.model());
    private static final DateTimeFormatter PRINT_DATE = DateTimeFormatter.ofPattern("dd/MM/uuuu");

    public byte[] render(PeiDocument plan) {
        var out = new ByteArrayOutputStream();
        try (var doc = new Document(PageSize.A4, 34, 34, 30, 30)) {
            PdfWriter.getInstance(doc, out);
            doc.addTitle(FORM.required("title").textValue());
            doc.open();
            new Form(doc, JSON.valueToTree(plan.getContent())).write(plan);
        } catch (IOException e) {
            throw new IllegalStateException("Falha ao carregar as fontes do Anexo I.", e);
        }
        return out.toByteArray();
    }

    private static final class Form {
        private final Document doc;
        private final JsonNode content;
        private final Font title = Liberation.SANS_BOLD.create(11);
        private final Font heading = Liberation.SANS_BOLD.create(9);
        private final Font body = Liberation.SANS.create(9);
        private final Font priority = Liberation.SANS_ITALIC.create(9);
        private final Font inventoryHeading = Liberation.SERIF_BOLD.create(10);
        private final Font inventoryBody = Liberation.SERIF.create(10);

        Form(Document doc, JsonNode content) throws IOException {
            this.doc = doc;
            this.content = content;
        }

        void write(PeiDocument plan) {
            Paragraph annex = line(label("annex"), title);
            annex.setAlignment(Element.ALIGN_CENTER);
            doc.add(annex);
            Paragraph name = line(FORM.required("title").textValue(), title);
            name.setAlignment(Element.ALIGN_CENTER);
            name.setSpacingAfter(12);
            doc.add(name);

            identification(plan);
            objectives();
            for (String key : List.of("professionalSkills", "syllabus", "prerequisites")) field(key);
            contents();
            field("teachingStrategies");
            field("methodologicalResources");
            assessment();
            field("recoveryProposal");
            bibliography("basicBibliography");
            bibliography("complementaryBibliography");
            inventory();
            closing();
        }

        private void identification(PeiDocument plan) {
            PdfPTable table = table(45, 55);
            for (String key : List.of("course", "subject", "teacherName", "student")) {
                table.addCell(span(pair(key, value(key)), 2));
            }
            String term = plan.getAcademicTermLabel() != null ? plan.getAcademicTermLabel() : plan.getAcademicTerm();
            PdfPCell termCell = pair("academicTerm", term);
            termCell.disableBorderSide(Rectangle.RIGHT);
            table.addCell(termCell);
            PdfPCell hours = pair("workloadHours", value("workloadHours"));
            hours.disableBorderSide(Rectangle.LEFT);
            table.addCell(hours);
            doc.add(table);
        }

        private void objectives() {
            PdfPTable table = table(40, 60);
            table.addCell(span(textCell(label("objectives"), heading), 2));
            PdfPCell left = cell();
            for (String key : List.of("generalObjectives", "specificObjectives")) fieldIn(left, key);
            table.addCell(left);
            PdfPCell right = cell();
            for (String key : List.of("eliminatedObjectives", "alternativeObjectives", "complementaryObjectives")) fieldIn(right, key);
            table.addCell(right);
            doc.add(table);
        }

        private void field(String key) {
            PdfPTable table = table(1);
            if (key.equals("methodologicalResources")) table.setSpacingBefore(7);
            table.addCell(textCell(label(key), heading));
            table.addCell(textCell(value(key), body));
            table.setHeaderRows(1);
            doc.add(table);
        }

        private void contents() {
            PdfPTable table = table(47, 53);
            table.addCell(textCell(label("contents"), heading));
            table.addCell(textCell(label("contentHours"), heading));
            table.setHeaderRows(1);
            JsonNode entries = content.path("contents");
            for (JsonNode row : entries) {
                table.addCell(textCell(row.path("description").asText(""), row.path("priority").asBoolean() ? priority : body));
                table.addCell(textCell(row.path("workloadHours").asText(""), body));
            }
            if (entries.isEmpty()) {
                table.addCell(textCell(" ", body));
                table.addCell(textCell(" ", body));
            }
            doc.add(table);
        }

        private void assessment() {
            PdfPTable table = table(54, 46);
            table.addCell(span(textCell(label("assessment"), heading), 2));
            table.setHeaderRows(1);
            PdfPCell criteria = cell();
            fieldIn(criteria, "assessmentCriteria");
            table.addCell(criteria);
            PdfPCell instruments = cell();
            paragraph(instruments, label("assessmentInstruments"), heading);
            for (JsonNode row : content.path("assessmentInstruments")) {
                paragraph(instruments, row.path("description").asText(""), body);
                paragraph(instruments, row.path("justification").asText(""), body);
            }
            table.addCell(instruments);
            doc.add(table);
        }

        private void bibliography(String key) {
            List<String> columns = List.of("Title", "Author", "Edition", "Location", "Publisher", "Year", "Lt");
            PdfPTable table = table(32, 16, 8, 12, 15, 9, 8);
            table.addCell(span(textCell(label(key), heading), columns.size()));
            for (String column : columns) {
                table.addCell(textCell(label("bibliography" + column), heading));
            }
            table.setHeaderRows(2);
            JsonNode entries = content.path(key);
            for (JsonNode row : entries) {
                for (String column : columns) table.addCell(textCell(row.path(column.toLowerCase(Locale.ROOT)).asText(""), body));
            }
            for (int row = entries.size(); row < 3; row++) {
                for (String ignored : columns) table.addCell(textCell(" ", body));
            }
            doc.add(table);
        }

        private void inventory() {
            JsonNode ratings = FORM.required("ratings");
            JsonNode answers = content.path("skillsInventory");
            JsonNode groups = FORM.required("inventoryGroups");
            for (int g = 0; g < groups.size(); g++) {
                JsonNode group = groups.get(g);
                PdfPTable table = table(1);
                // Keep each short indicator and its choices together when a page fills.
                table.setSplitRows(false);
                if (g == 0) table.addCell(textCell(label("skillsInventory"), heading));
                PdfPCell header = inventoryCell();
                header.setPaddingTop(9);
                paragraph(header, group.required("label").textValue(), inventoryHeading);
                table.addCell(header);
                table.setHeaderRows(g == 0 ? 2 : 1);
                JsonNode indicators = group.required("indicators");
                for (int i = 0; i < indicators.size(); i++) {
                    JsonNode indicator = indicators.get(i);
                    PdfPCell cell = inventoryCell();
                    paragraph(cell, "- " + indicator.required("label").textValue(), inventoryHeading);
                    if (indicator.required("hasOptions").asBoolean()) {
                        String selected = answers.path(indicator.required("id").asText()).asText();
                        var choices = new Paragraph();
                        choices.setLeading(13);
                        choices.setSpacingBefore(3);
                        for (JsonNode rating : ratings) {
                            String mark = rating.required("value").asText().equals(selected) ? "[X] " : "[ ] ";
                            choices.add(new Chunk(mark + rating.required("label").textValue() + "   ", inventoryBody));
                        }
                        cell.addElement(choices);
                    }
                    if (i == indicators.size() - 1 && g == groups.size() - 1) {
                        cell.enableBorderSide(Rectangle.BOTTOM);
                        cell.setPaddingBottom(12);
                    }
                    table.addCell(cell);
                }
                doc.add(table);
            }
        }

        private void closing() {
            PdfPTable table = table(1);
            table.setSpacingBefore(9);
            PdfPCell observations = pair("observations", value("observations"));
            observations.setBorder(Rectangle.NO_BORDER);
            table.addCell(observations);
            PdfPCell signature = cell();
            signature.setBorder(Rectangle.NO_BORDER);
            paragraph(signature, label("signature") + " _________________________________________", body);
            String date = value("documentDate");
            Paragraph placeDate = line(label("location") + " " + blankLine(value("location"), "____________________________")
                    + "   " + label("documentDate") + " " + (date.isBlank() ? "____/____/________" : LocalDate.parse(date).format(PRINT_DATE)), body);
            placeDate.setSpacingBefore(4);
            signature.addElement(placeDate);
            table.addCell(signature);
            doc.add(table);
        }

        private PdfPCell pair(String key, String text) {
            Paragraph p = line(label(key), heading);
            if (text != null && !text.isBlank()) p.add(new Chunk(" " + text, body));
            PdfPCell cell = cell();
            cell.addElement(p);
            return cell;
        }

        private void fieldIn(PdfPCell cell, String key) {
            paragraph(cell, label(key), heading);
            cell.addElement(line(value(key), body));
        }

        private String value(String key) {
            JsonNode node = content.path(key);
            if (!node.isArray()) return node.asText("");
            var values = new ArrayList<String>();
            for (JsonNode item : node) if (item.isTextual()) values.add(item.textValue());
            return String.join("\n", values);
        }

        private static String blankLine(String value, String blank) {
            return value.isBlank() ? blank : value;
        }

        private static PdfPTable table(float... widths) {
            PdfPTable table = new PdfPTable(widths);
            table.setWidthPercentage(100);
            table.setSplitLate(false);
            return table;
        }

        private static PdfPCell cell() {
            PdfPCell cell = new PdfPCell();
            cell.setBorderWidth(.55f);
            cell.setPadding(3);
            cell.setUseAscender(true);
            cell.setUseDescender(true);
            return cell;
        }

        private static PdfPCell inventoryCell() {
            PdfPCell cell = cell();
            cell.setBorder(Rectangle.LEFT | Rectangle.RIGHT);
            cell.setPaddingTop(6);
            return cell;
        }

        private static PdfPCell textCell(String text, Font font) {
            PdfPCell cell = cell();
            cell.addElement(line(text, font));
            return cell;
        }

        private static PdfPCell span(PdfPCell cell, int columns) {
            cell.setColspan(columns);
            return cell;
        }

        private static Paragraph line(String value, Font font) {
            Paragraph p = new Paragraph(value.isBlank() ? " " : value, font);
            p.setLeading(0, 1.2f);
            return p;
        }

        private static void paragraph(PdfPCell cell, String text, Font font) {
            if (!text.isBlank()) cell.addElement(line(text, font));
        }

        private static String label(String key) {
            return FORM.required("labels").required(key).textValue();
        }
    }
}
