Trivy source secret scan
Secret values and matched source text are omitted from this report.
{{- $found := false }}
{{- range . }}
{{- $target := .Target }}
{{- range .Secrets }}
{{- $found = true }}

File: {{ printf "%q" $target }}
Rule: {{ .RuleID }}
Severity: {{ .Severity }}
Line: {{ .StartLine }}
{{- end }}
{{- end }}
{{ if not $found }}
No secret patterns detected in the scanned files.
{{- end }}
