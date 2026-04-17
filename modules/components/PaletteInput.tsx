// SDOA v1.2 compliant — Fast UI Component
import { invoke } from "@tauri-apps/api/tauri";
import { useState } from "react";

export const PaletteInput = () => {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);

    const handleSearch = async (val: string) => {
        setQuery(val);
        if (val.length > 2) {
            // SDOA Routing: Search -> QmdAdapter -> VSearch
            const data = await invoke("sdoa_route", {
                target: "QmdAdapter",
                method: "search",
                args: { query: val }
            });
            setResults(data);
        }
    };

    return (
        <div className="command-palette">
            <input 
                autoFocus 
                placeholder="Search project or ask SDOA..." 
                onChange={(e) => handleSearch(e.target.value)}
            />
            <div className="results-list">
                {results.map(res => (
                    <div key={res.id} className="result-item">
                        <span>{res.file}</span>
                        <small>{res.snippet_preview}</small>
                    </div>
                ))}
            </div>
        </div>
    );
};