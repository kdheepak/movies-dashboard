importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/wheels/bokeh-3.6.2-py3-none-any.whl', 'https://cdn.holoviz.org/panel/1.5.5/dist/wheels/panel-1.5.5-py3-none-any.whl', 'pyodide-http==0.2.1', 'holoviews', 'pandas', 'param']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  \nimport asyncio\n\nfrom panel.io.pyodide import init_doc, write_doc\n\ninit_doc()\n\n# -*- coding: utf-8 -*-\nimport param as pm\nimport pandas as pd\nimport panel as pn\nimport holoviews as hv\n\npd.options.mode.copy_on_write = True\npd.options.future.no_silent_downcasting = True\n\npn.extension(\n    "tabulator",\n    sizing_mode="stretch_width",\n    notifications=True,\n    throttled=True,\n)\nhv.extension("bokeh")\n\n\nclass Movies(pm.Parameterized):\n    df = pm.DataFrame()\n    filtered_df = pm.DataFrame()\n    year_range = pm.Range()\n    ratings_range = pm.Range()\n    runtime_range = pm.Range()\n    genre = pm.Selector()\n\n    def _preprocess_data(self):\n        title_basics = pd.read_csv(\n            "https://datasets.imdbws.com/title.basics.tsv.gz",\n            sep="\\t",\n            dtype={\n                "tconst": "object",\n                "primaryTitle": "object",\n                "titleType": "object",\n                "runtimeMinutes": "object",\n                "startYear": "object",\n            },\n            usecols=[\n                "tconst",\n                "titleType",\n                "primaryTitle",\n                "runtimeMinutes",\n                "startYear",\n                "genres",\n            ],\n            na_values="\\\\N",  # Replace '\\N' with NaN\n            nrows=5000,\n        ).query("titleType == 'movie'")\n        title_ratings = pd.read_csv(\n            "https://datasets.imdbws.com/title.ratings.tsv.gz",\n            sep="\\t",\n            dtype={"tconst": "object", "averageRating": "float64", "numVotes": "int64"},\n            usecols=["tconst", "averageRating", "numVotes"],\n            nrows=5000,\n        )\n        movies = title_basics.merge(title_ratings, on="tconst").dropna()\n        movies["startYear"] = pd.to_numeric(movies["startYear"], downcast="integer")\n        movies["runtimeMinutes"] = pd.to_numeric(movies["runtimeMinutes"], downcast="integer")\n        movies["genres"] = movies["genres"].str.split(",")\n        movies = movies.explode("genres")\n        self.df = movies\n\n    @pm.depends("df", watch=True, on_init=True)\n    def _update_bounds(self):\n        if self.df is None:\n            return\n\n        self.param.year_range.bounds = (\n            int(self.df.startYear.min()),\n            int(self.df.startYear.max()),\n        )\n        self.year_range = (\n            int(self.df.startYear.min()),\n            int(self.df.startYear.max()),\n        )\n\n        self.param.ratings_range.bounds = (0, 10)\n        self.ratings_range = (0, 10)\n\n        self.param.runtime_range.bounds = (\n            int(self.df.runtimeMinutes.min()),\n            int(self.df.runtimeMinutes.max()),\n        )\n\n        self.runtime_range = (\n            int(self.df.runtimeMinutes.min()),\n            int(self.df.runtimeMinutes.max()),\n        )\n\n        self.param.genre.objects = list(self.df.genres.unique())\n        self.genre = self.df.genres.unique()[0]\n\n    @pm.depends(\n        "df",\n        "year_range",\n        "ratings_range",\n        "runtime_range",\n        "genre",\n        watch=True,\n        on_init=True,\n    )\n    def _update_table(self):\n        if self.year_range is None or self.ratings_range is None or self.runtime_range is None:\n            return self.df\n        df, year_range, ratings_range, runtime_range, genre = (\n            self.df,\n            self.year_range,\n            self.ratings_range,\n            self.runtime_range,\n            self.genre,\n        )\n        self.filtered_df = (\n            df.query(f"genres == '{genre}'")\n            .query(f"startYear >= {year_range[0]}")\n            .query(f"startYear <= {year_range[-1]}")\n            .query(f"averageRating >= {ratings_range[0]}")\n            .query(f"averageRating <= {ratings_range[-1]}")\n            .query(f"runtimeMinutes >= {runtime_range[0]}")\n            .query(f"runtimeMinutes <= {runtime_range[-1]}")\n        )\n\n    @pm.depends("filtered_df")\n    def _update_plot(self):\n        plot = hv.BoxWhisker(self.filtered_df, kdims=["startYear"], vdims=["averageRating"],).opts(\n            width=900,\n            height=400,\n            title=f"IMDb Movies - {self.genre}",\n            xlabel="Year",\n            ylabel="IMDb Rating",\n            ylim=(0, 10),\n            xrotation=90,\n        )\n\n        return plot\n\n    def panel(self):\n        table = pn.widgets.Tabulator(\n            self.param.filtered_df,\n            pagination="remote",\n            page_size=10,\n        )\n        genres = pn.widgets.Select.from_param(self.param.genre)\n        plot = self._update_plot\n\n        layout = pn.Column(\n            pn.Row(\n                self.param.ratings_range,\n                self.param.year_range,\n                self.param.runtime_range,\n            ),\n            pn.Row(genres),\n            pn.Tabs(("Visualization", hv.DynamicMap(plot)), ("Data", table)),\n        )\n        return layout\n\n\napp = Movies()\ntemplate = pn.template.BootstrapTemplate(\n    title="Movies Dashboard",\n    sidebar=pn.Card(\n        pn.pane.Markdown(\n            r"""\n# Movies Dashboard\n\nThis panel downloads IMDb database and visualizes average rating for per genre for each year.\n                                     """\n        )\n    ),\n)\ntemplate.main.append(pn.Card(app.panel, title="Movies Dashboard"))\n\npn.state.onload(app._preprocess_data)\n\ntemplate.servable()\n\n\nawait write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.globals.set('patch', msg.patch)
    self.pyodide.runPythonAsync(`
    from panel.io.pyodide import _convert_json_patch
    state.curdoc.apply_json_patch(_convert_json_patch(patch), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.globals.set('location', msg.location)
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads(location)
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()