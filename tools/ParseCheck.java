import com.sun.source.util.JavacTask;
import javax.tools.*;
import java.io.File;
import java.nio.file.*;
import java.util.*;

/**
 * Syntax check for the app's Java sources.
 *
 * Runs only the compiler's parse phase, so it needs no android.jar and no
 * KING JIM SDK — both of which are unavailable to CI and to anyone who has not
 * accepted the SDK licence. It therefore catches syntax errors, but not
 * unresolved symbols or type errors; a real build still needs the Android SDK.
 *
 *   javac -d out tools/ParseCheck.java
 *   java -cp out ParseCheck app/src/main/java
 */
public class ParseCheck {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            System.err.println("usage: ParseCheck <source-root>...");
            System.exit(2);
        }
        List<File> files = new ArrayList<>();
        for (String root : args) {
            Files.walk(Paths.get(root))
                 .filter(p -> p.toString().endsWith(".java"))
                 .forEach(p -> files.add(p.toFile()));
        }
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
        StandardJavaFileManager fm = compiler.getStandardFileManager(diags, null, null);
        JavacTask task = (JavacTask) compiler.getTask(
            null, fm, diags, List.of("-proc:none"), null, fm.getJavaFileObjectsFromFiles(files));
        task.parse();
        int errors = 0;
        for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
            if (d.getKind() == Diagnostic.Kind.ERROR) errors++;
            System.out.printf("%s %s:%d %s%n", d.getKind(),
                d.getSource() == null ? "?" : d.getSource().getName(), d.getLineNumber(), d.getMessage(null));
        }
        System.out.printf("parsed %d file(s), %d error(s)%n", files.size(), errors);
        if (files.isEmpty()) {
            System.err.println("no .java files found — check the source root");
            System.exit(2);
        }
        System.exit(errors == 0 ? 0 : 1);
    }
}
