import fs from 'fs/promises';
import path from 'path';
import { Tool, ToolContext } from '../core/types';

export const ragTools: Tool[] = [
    {
        name: 'rag_ingest_file',
        description: 'Read and extract relevant content from a large local file (.txt, .md, .csv) based on a keyword query. Use this to pull external knowledge into context without blowing the token limits.',
        parameters: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Absolute path to the document.' },
                query: { type: 'string', description: 'A specific keyword or phrase to search for within the document.' },
                contextLines: { type: 'number', description: 'Number of surrounding lines to return. Default is 3.' }
            },
            required: ['filePath', 'query']
        },
        execute: async (args: Record<string, any>, context: ToolContext): Promise<string> => {
            try {
                const target = path.resolve(args.filePath);
                const stat = await fs.stat(target);

                // Allow up to 10MB documents
                if (stat.size > 1024 * 1024 * 10) {
                    return `Error: Document is too large (${(stat.size / 1024 / 1024).toFixed(2)}MB). Limit is 10MB for RAG.`;
                }

                const content = await fs.readFile(target, 'utf-8');
                const lines = content.split('\n');

                const query = args.query.toLowerCase();
                const padding = args.contextLines || 3;
                let results: string[] = [];
                let matchCount = 0;

                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(query)) {
                        matchCount++;
                        // Extract with context padding
                        const start = Math.max(0, i - padding);
                        const end = Math.min(lines.length - 1, i + padding);

                        const chunk = lines.slice(start, end + 1).map((l, index) => `L${start + index + 1}: ${l}`).join('\n');
                        results.push(`--- Match ${matchCount} ---\n${chunk}`);

                        // Limit to 5 matches to avoid filling context window
                        if (matchCount >= 5) {
                            results.push(`\n... (And more matches. Refine your query to see deeper).`);
                            break;
                        }

                        // Skip the padded lines we just extracted
                        i = end;
                    }
                }

                if (results.length === 0) {
                    return `No matches found for "${args.query}" in ${args.filePath}`;
                }

                return results.join('\n\n');

            } catch (error: any) {
                return `RAG Extraction Error: ${error.message}`;
            }
        }
    }
];
