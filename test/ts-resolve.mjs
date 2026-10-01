// Lets `node --test` load src/ as-is: its imports are extensionless, as esbuild and tsc expect.
import { register } from "node:module";

register(
	"data:text/javascript," +
		encodeURIComponent(`
export async function resolve(specifier, context, next) {
	if (/^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) {
		try { return await next(specifier + ".ts", context); } catch {}
	}
	return next(specifier, context);
}`),
);
