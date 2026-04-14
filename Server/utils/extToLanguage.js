function extToLanguage(filenameOrExt) {
    const name = String(filenameOrExt || "").trim();
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : name.toLowerCase();

    const map = {
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        py: "python",
        java: "java",
        cpp: "cpp",
        c: "cpp",
        cs: "csharp",
        html: "html",
        css: "css",
        json: "json",
        md: "markdown",
        sh: "shell",
        go: "go",
        rs: "rust",
        php: "php",
        rb: "ruby",
        yml: "yaml",
        yaml: "yaml",
        svg: "xml",
        xml: "xml",
        toml: "toml",
        kt: "kotlin",
        swift: "swift",
    };

    return map[ext] || "plaintext";
}

module.exports = { extToLanguage };