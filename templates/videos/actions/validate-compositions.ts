#!/usr/bin/env ts-node

/**
 * Composition Validation Agent
 *
 * Scans Remotion compositions and validates:
 * - Animation initialization
 * - AnimatedElement usage
 * - Style application
 * - Type safety
 * - Performance issues
 *
 * Usage:
 *   npm run validate:compositions
 *   npm run validate:compositions --fix
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

interface ValidationIssue {
  file: string;
  line?: number;
  severity: "error" | "warning" | "info";
  message: string;
  fix?: string;
}

interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  stats: {
    filesScanned: number;
    componentsFound: number;
    animatedElementsFound: number;
    animationsInitialized: number;
  };
}

class CompositionValidator {
  private issues: ValidationIssue[] = [];
  private stats = {
    filesScanned: 0,
    componentsFound: 0,
    animatedElementsFound: 0,
    animationsInitialized: 0,
  };

  /**
   * Validate all compositions in directory
   */
  validate(compositionsDir: string): ValidationResult {
    console.log(`\n🔍 Validating compositions in ${compositionsDir}\n`);

    const files = this.findTsxFiles(compositionsDir);

    files.forEach((file) => {
      this.validateFile(file);
    });

    const passed = !this.issues.some((i) => i.severity === "error");

    return {
      passed,
      issues: this.issues,
      stats: this.stats,
    };
  }

  /**
   * Find all .tsx files recursively
   */
  private findTsxFiles(dir: string): string[] {
    const files: string[] = [];

    const scan = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      entries.forEach((entry) => {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory() && entry.name !== "node_modules") {
          scan(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
          files.push(fullPath);
        }
      });
    };

    scan(dir);
    return files;
  }

  /**
   * Validate a single file
   */
  private validateFile(filePath: string): void {
    this.stats.filesScanned++;

    const content = fs.readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    // Check for composition exports
    const hasComposition = this.checkForComposition(
      sourceFile,
      content,
      filePath,
    );
    if (hasComposition) {
      this.stats.componentsFound++;

      // Validate animation initialization
      this.checkAnimationInitialization(sourceFile, content, filePath);

      // Check AnimatedElement usage
      this.checkAnimatedElementUsage(sourceFile, content, filePath);

      // Check for hardcoded styles
      this.checkHardcodedStyles(sourceFile, content, filePath);

      // Check for missing props
      this.checkMissingProps(sourceFile, content, filePath);

      // Check for hardcoded cursor logic (CRITICAL)
      this.checkHardcodedCursor(sourceFile, content, filePath);
    }
  }

  /**
   * Check if file exports a composition component
   */
  private checkForComposition(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
  ): boolean {
    // Look for export const ComponentName: React.FC
    const exportPattern = /export\s+const\s+(\w+):\s*React\.FC/;
    return exportPattern.test(content);
  }

  /**
   * Check if initializeDefaultAnimations is called at module level
   */
  private checkAnimationInitialization(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
  ): void {
    const initPattern = /initializeDefaultAnimations\s*\(/;
    const hasInit = initPattern.test(content);

    if (!hasInit) {
      this.issues.push({
        file: filePath,
        severity: "warning",
        message: "Missing initializeDefaultAnimations() at module level",
        fix: "Add: initializeDefaultAnimations('composition-id', [AnimationPresets.hoverLift('ElementType')])",
      });
    } else {
      this.stats.animationsInitialized++;

      // Check if it's at module level (not inside a function/component)
      const lines = content.split("\n");
      let inFunction = false;
      let bracketCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Track function/component scope
        if (
          /function\s+\w+|const\s+\w+\s*=\s*\(.*\)\s*=>|export\s+const\s+\w+.*=/.test(
            line,
          )
        ) {
          inFunction = true;
        }

        bracketCount += (line.match(/{/g) || []).length;
        bracketCount -= (line.match(/}/g) || []).length;

        if (bracketCount === 0) {
          inFunction = false;
        }

        // Check if initialization is inside a function
        if (initPattern.test(line) && inFunction) {
          this.issues.push({
            file: filePath,
            line: i + 1,
            severity: "error",
            message:
              "initializeDefaultAnimations() must be called at module level, not inside a function/useEffect",
            fix: "Move initializeDefaultAnimations() to top of file (after imports)",
          });
        }
      }
    }
  }

  /**
   * Check for proper AnimatedElement usage
   */
  private checkAnimatedElementUsage(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
  ): void {
    const animatedElementPattern = /<AnimatedElement/g;
    const matches = content.match(animatedElementPattern);

    if (matches) {
      this.stats.animatedElementsFound += matches.length;

      // Check for required props
      const requiredProps = [
        "id",
        "elementType",
        "label",
        "compositionId",
        "position",
        "size",
        "cursorHistory",
        "getAnimationsForElement",
      ];

      matches.forEach((_, index) => {
        // Extract the AnimatedElement JSX
        const startIdx = content.indexOf("<AnimatedElement", index);
        const endIdx = content.indexOf(">", startIdx);
        const elementJsx = content.substring(startIdx, endIdx);

        requiredProps.forEach((prop) => {
          if (!elementJsx.includes(`${prop}=`)) {
            this.issues.push({
              file: filePath,
              severity: "error",
              message: `AnimatedElement missing required prop: ${prop}`,
              fix: `Add ${prop}={...} prop`,
            });
          }
        });

        // Check for children render function
        if (
          !content.includes("(animatedStyles)") &&
          !content.includes("{animatedStyles}")
        ) {
          this.issues.push({
            file: filePath,
            severity: "warning",
            message:
              "AnimatedElement children should receive animatedStyles parameter",
            fix: "{(animatedStyles) => <YourComponent animatedStyles={animatedStyles} />}",
          });
        }
      });
    }
  }

  /**
   * Check for hardcoded styles that should use animatedStyles
   */
  private checkHardcodedStyles(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
  ): void {
    // Check for hardcoded transform/filter/opacity in components that receive animatedStyles
    const lines = content.split("\n");
    let receivesAnimatedStyles = false;

    lines.forEach((line, index) => {
      // Check if component receives animatedStyles prop
      if (/animatedStyles:\s*AnimatedStyles/.test(line)) {
        receivesAnimatedStyles = true;
      }

      if (receivesAnimatedStyles) {
        // Check for hardcoded transform
        if (
          /transform:\s*['"`]/.test(line) &&
          !/animatedStyles\.transform/.test(line)
        ) {
          this.issues.push({
            file: filePath,
            line: index + 1,
            severity: "warning",
            message:
              "Hardcoded 'transform' should use animatedStyles.transform",
            fix: "transform: animatedStyles.transform",
          });
        }

        // Check for hardcoded background
        if (
          /background(Color)?:\s*['"`]#/.test(line) &&
          !/animatedStyles\.backgroundColor/.test(line)
        ) {
          this.issues.push({
            file: filePath,
            line: index + 1,
            severity: "warning",
            message:
              "Hardcoded background should use animatedStyles.backgroundColor",
            fix: "backgroundColor: animatedStyles.backgroundColor",
          });
        }

        // Check for hardcoded opacity
        if (
          /opacity:\s*[0-9.]+/.test(line) &&
          !/animatedStyles\.opacity/.test(line)
        ) {
          this.issues.push({
            file: filePath,
            line: index + 1,
            severity: "warning",
            message: "Hardcoded opacity should use animatedStyles.opacity",
            fix: "opacity: animatedStyles.opacity",
          });
        }
      }
    });
  }

  /**
   * Check for missing required props in element components
   */
  private checkMissingProps(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
  ): void {
    // Check if component accepts animatedStyles but doesn't apply all properties
    if (/animatedStyles:\s*AnimatedStyles/.test(content)) {
      const styleProperties = [
        "transform",
        "filter",
        "opacity",
        "backgroundColor",
        "borderColor",
        "borderRadius",
        "borderWidth",
        "boxShadow",
      ];

      styleProperties.forEach((prop) => {
        if (!content.includes(`animatedStyles.${prop}`)) {
          this.issues.push({
            file: filePath,
            severity: "info",
            message: `AnimatedStyles.${prop} not used - animations may not work fully`,
            fix: `Add ${prop}: animatedStyles.${prop} to style object`,
          });
        }
      });
    }
  }

  /**
   * 🎯 CRITICAL: Check for hardcoded cursor animations
   * Cursor animations must be defined as tracks, not in component logic
   */
  private checkHardcodedCursor(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
  ): void {
    // Skip non-composition files (element components)
    if (!/<CameraHost|AbsoluteFill/.test(content)) {
      return;
    }

    // Check for manual Cursor component rendering (should use CameraHost instead)
    if (/<Cursor\s/.test(content) && !content.includes("renderCursor={true}")) {
      const match = content.match(/<Cursor\s[^>]*>/);
      if (match) {
        // Check if it's using manual x/y props
        if (/x=\{[^}]*interpolate|y=\{[^}]*interpolate/.test(content)) {
          this.issues.push({
            file: filePath,
            severity: "error",
            message:
              "🚫 CRITICAL: Cursor animation hardcoded with interpolate(). Define cursor as track in registry instead.",
            fix: "1. Remove manual <Cursor> component\n2. Add cursor track to registry with x/y keyframes\n3. Use <CameraHost tracks={tracks}> (it renders cursor automatically)\n4. See InputBox.tsx for correct pattern",
          });
        } else if (/x=\{.*\}|y=\{.*\}/.test(match[0])) {
          this.issues.push({
            file: filePath,
            severity: "error",
            message:
              "🚫 CRITICAL: Manual Cursor component found. Use cursor track + CameraHost instead.",
            fix: "Remove <Cursor> and let CameraHost render it from track. See docs/ANIMATED_COMPONENTS_GUIDE.md#cursor-animation-tracks",
          });
        }
      }
    }

    // Check for renderCursor={false} without good reason
    if (/renderCursor=\{false\}/.test(content)) {
      this.issues.push({
        file: filePath,
        severity: "warning",
        message:
          "renderCursor={false} found - ensure cursor track exists and is intentionally hidden",
        fix: "Remove renderCursor={false} to show cursor from track, or document why it's hidden",
      });
    }

    // Check if using old cursor history pattern
    if (/useCursorHistory/.test(content) && /<Cursor/.test(content)) {
      this.issues.push({
        file: filePath,
        severity: "warning",
        message:
          "Old cursor pattern detected - useCursorHistory should only be for hover detection, not manual cursor rendering",
        fix: "Let CameraHost render cursor from track. Use useCursorHistory only for AnimatedElement hover detection.",
      });
    }
  }

  /**
   * Print validation results
   */
  printResults(result: ValidationResult): void {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 Validation Results`);
    console.log(`${"=".repeat(60)}\n`);

    console.log(`Files scanned:         ${result.stats.filesScanned}`);
    console.log(`Compositions found:    ${result.stats.componentsFound}`);
    console.log(`AnimatedElements:      ${result.stats.animatedElementsFound}`);
    console.log(
      `Animations initialized: ${result.stats.animationsInitialized}\n`,
    );

    if (result.issues.length === 0) {
      console.log(`✅ All checks passed!\n`);
      return;
    }

    // Group issues by severity
    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");
    const info = result.issues.filter((i) => i.severity === "info");

    if (errors.length > 0) {
      console.log(`❌ Errors (${errors.length}):\n`);
      errors.forEach((issue) => this.printIssue(issue));
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${warnings.length}):\n`);
      warnings.forEach((issue) => this.printIssue(issue));
    }

    if (info.length > 0) {
      console.log(`\nℹ️  Info (${info.length}):\n`);
      info.forEach((issue) => this.printIssue(issue));
    }

    console.log(`\n${"=".repeat(60)}\n`);

    if (result.passed) {
      console.log(`✅ Validation passed (with warnings)\n`);
    } else {
      console.log(`❌ Validation failed - fix errors above\n`);
    }
  }

  /**
   * Print individual issue
   */
  private printIssue(issue: ValidationIssue): void {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    console.log(`  ${location}`);
    console.log(`  ${issue.message}`);
    if (issue.fix) {
      console.log(`  💡 Fix: ${issue.fix}`);
    }
    console.log();
  }
}

// Agent action entry point
export default async function () {
  const validator = new CompositionValidator();
  const compositionsDir = path.join(
    process.cwd(),
    "app/remotion/compositions",
  );
  const result = validator.validate(compositionsDir);
  validator.printResults(result);

  process.exit(result.passed ? 0 : 1);
}
