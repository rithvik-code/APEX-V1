import{M as a,O as Ye,B as se,m as fe,n as $,U as me,o as C,p as ce,q as de,N as Ke,l as Ne,C as ie,V as h,j as x,h as M,r as qe,s as Xe,t as $e,u as je,v as Ze,w as Je,A as Le,x as et,y as tt,z as st,E as A,I as Ce,d as H,J as De,K as Fe,Q as y,T as b,X as z,g as oe,Y as R,e as it,Z as ue,_ as Ge,$ as ot,f as nt,c as Oe,i as Se,L as X,a0 as at,a1 as We,a2 as He,W as rt,S as lt,F as ht,P as ct,a as dt,R as ut,H as pt,D as be,b as Me,G as ft,a3 as Be,a4 as xe,a5 as mt,a6 as Ue,a7 as E,a8 as gt}from"./engines-CS87Qcan.js";const pe={name:"CopyShader",uniforms:{tDiffuse:{value:null},opacity:{value:1}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform float opacity;

		uniform sampler2D tDiffuse;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );
			gl_FragColor = opacity * texel;


		}`};class Z{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}const wt=new Ye(-1,1,1,-1,0,1);class vt extends se{constructor(){super(),this.setAttribute("position",new fe([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new fe([0,2,0,0,2,0],2))}}const bt=new vt;class ye{constructor(e){this._mesh=new a(bt,e)}dispose(){this._mesh.geometry.dispose()}render(e){e.render(this._mesh,wt)}get material(){return this._mesh.material}set material(e){this._mesh.material=e}}class Ve extends Z{constructor(e,t="tDiffuse"){super(),this.textureID=t,this.uniforms=null,this.material=null,e instanceof $?(this.uniforms=e.uniforms,this.material=e):e&&(this.uniforms=me.clone(e.uniforms),this.material=new $({name:e.name!==void 0?e.name:"unspecified",defines:Object.assign({},e.defines),uniforms:this.uniforms,vertexShader:e.vertexShader,fragmentShader:e.fragmentShader})),this._fsQuad=new ye(this.material)}render(e,t,i){this.uniforms[this.textureID]&&(this.uniforms[this.textureID].value=i.texture),this._fsQuad.material=this.material,this.renderToScreen?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}}class ze extends Z{constructor(e,t){super(),this.scene=e,this.camera=t,this.clear=!0,this.needsSwap=!1,this.inverse=!1}render(e,t,i){const o=e.getContext(),s=e.state;s.buffers.color.setMask(!1),s.buffers.depth.setMask(!1),s.buffers.color.setLocked(!0),s.buffers.depth.setLocked(!0);let r,c;this.inverse?(r=0,c=1):(r=1,c=0),s.buffers.stencil.setTest(!0),s.buffers.stencil.setOp(o.REPLACE,o.REPLACE,o.REPLACE),s.buffers.stencil.setFunc(o.ALWAYS,r,4294967295),s.buffers.stencil.setClear(c),s.buffers.stencil.setLocked(!0),e.setRenderTarget(i),this.clear&&e.clear(),e.render(this.scene,this.camera),e.setRenderTarget(t),this.clear&&e.clear(),e.render(this.scene,this.camera),s.buffers.color.setLocked(!1),s.buffers.depth.setLocked(!1),s.buffers.color.setMask(!0),s.buffers.depth.setMask(!0),s.buffers.stencil.setLocked(!1),s.buffers.stencil.setFunc(o.EQUAL,1,4294967295),s.buffers.stencil.setOp(o.KEEP,o.KEEP,o.KEEP),s.buffers.stencil.setLocked(!0)}}class Mt extends Z{constructor(){super(),this.needsSwap=!1}render(e){e.state.buffers.stencil.setLocked(!1),e.state.buffers.stencil.setTest(!1)}}class xt{constructor(e,t){if(this.renderer=e,this._pixelRatio=e.getPixelRatio(),t===void 0){const i=e.getSize(new C);this._width=i.width,this._height=i.height,t=new ce(this._width*this._pixelRatio,this._height*this._pixelRatio,{type:de}),t.texture.name="EffectComposer.rt1"}else this._width=t.width,this._height=t.height;this.renderTarget1=t,this.renderTarget2=t.clone(),this.renderTarget2.texture.name="EffectComposer.rt2",this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2,this.renderToScreen=!0,this.passes=[],this.copyPass=new Ve(pe),this.copyPass.material.blending=Ke,this.clock=new Ne}swapBuffers(){const e=this.readBuffer;this.readBuffer=this.writeBuffer,this.writeBuffer=e}addPass(e){this.passes.push(e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}insertPass(e,t){this.passes.splice(t,0,e),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}removePass(e){const t=this.passes.indexOf(e);t!==-1&&this.passes.splice(t,1)}isLastEnabledPass(e){for(let t=e+1;t<this.passes.length;t++)if(this.passes[t].enabled)return!1;return!0}render(e){e===void 0&&(e=this.clock.getDelta());const t=this.renderer.getRenderTarget();let i=!1;for(let o=0,s=this.passes.length;o<s;o++){const r=this.passes[o];if(r.enabled!==!1){if(r.renderToScreen=this.renderToScreen&&this.isLastEnabledPass(o),r.render(this.renderer,this.writeBuffer,this.readBuffer,e,i),r.needsSwap){if(i){const c=this.renderer.getContext(),l=this.renderer.state.buffers.stencil;l.setFunc(c.NOTEQUAL,1,4294967295),this.copyPass.render(this.renderer,this.writeBuffer,this.readBuffer,e),l.setFunc(c.EQUAL,1,4294967295)}this.swapBuffers()}ze!==void 0&&(r instanceof ze?i=!0:r instanceof Mt&&(i=!1))}}this.renderer.setRenderTarget(t)}reset(e){if(e===void 0){const t=this.renderer.getSize(new C);this._pixelRatio=this.renderer.getPixelRatio(),this._width=t.width,this._height=t.height,e=this.renderTarget1.clone(),e.setSize(this._width*this._pixelRatio,this._height*this._pixelRatio)}this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.renderTarget1=e,this.renderTarget2=e.clone(),this.writeBuffer=this.renderTarget1,this.readBuffer=this.renderTarget2}setSize(e,t){this._width=e,this._height=t;const i=this._width*this._pixelRatio,o=this._height*this._pixelRatio;this.renderTarget1.setSize(i,o),this.renderTarget2.setSize(i,o);for(let s=0;s<this.passes.length;s++)this.passes[s].setSize(i,o)}setPixelRatio(e){this._pixelRatio=e,this.setSize(this._width,this._height)}dispose(){this.renderTarget1.dispose(),this.renderTarget2.dispose(),this.copyPass.dispose()}}class Tt extends Z{constructor(e,t,i=null,o=null,s=null){super(),this.scene=e,this.camera=t,this.overrideMaterial=i,this.clearColor=o,this.clearAlpha=s,this.clear=!0,this.clearDepth=!1,this.needsSwap=!1,this._oldClearColor=new ie}render(e,t,i){const o=e.autoClear;e.autoClear=!1;let s,r;this.overrideMaterial!==null&&(r=this.scene.overrideMaterial,this.scene.overrideMaterial=this.overrideMaterial),this.clearColor!==null&&(e.getClearColor(this._oldClearColor),e.setClearColor(this.clearColor,e.getClearAlpha())),this.clearAlpha!==null&&(s=e.getClearAlpha(),e.setClearAlpha(this.clearAlpha)),this.clearDepth==!0&&e.clearDepth(),e.setRenderTarget(this.renderToScreen?null:i),this.clear===!0&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),e.render(this.scene,this.camera),this.clearColor!==null&&e.setClearColor(this._oldClearColor),this.clearAlpha!==null&&e.setClearAlpha(s),this.overrideMaterial!==null&&(this.scene.overrideMaterial=r),e.autoClear=o}}const Ct={uniforms:{tDiffuse:{value:null},luminosityThreshold:{value:1},smoothWidth:{value:1},defaultColor:{value:new ie(0)},defaultOpacity:{value:0}},vertexShader:`

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		uniform sampler2D tDiffuse;
		uniform vec3 defaultColor;
		uniform float defaultOpacity;
		uniform float luminosityThreshold;
		uniform float smoothWidth;

		varying vec2 vUv;

		void main() {

			vec4 texel = texture2D( tDiffuse, vUv );

			float v = luminance( texel.xyz );

			vec4 outputColor = vec4( defaultColor.rgb, defaultOpacity );

			float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, v );

			gl_FragColor = mix( outputColor, texel, alpha );

		}`};class j extends Z{constructor(e,t=1,i,o){super(),this.strength=t,this.radius=i,this.threshold=o,this.resolution=e!==void 0?new C(e.x,e.y):new C(256,256),this.clearColor=new ie(0,0,0),this.needsSwap=!1,this.renderTargetsHorizontal=[],this.renderTargetsVertical=[],this.nMips=5;let s=Math.round(this.resolution.x/2),r=Math.round(this.resolution.y/2);this.renderTargetBright=new ce(s,r,{type:de}),this.renderTargetBright.texture.name="UnrealBloomPass.bright",this.renderTargetBright.texture.generateMipmaps=!1;for(let u=0;u<this.nMips;u++){const f=new ce(s,r,{type:de});f.texture.name="UnrealBloomPass.h"+u,f.texture.generateMipmaps=!1,this.renderTargetsHorizontal.push(f);const w=new ce(s,r,{type:de});w.texture.name="UnrealBloomPass.v"+u,w.texture.generateMipmaps=!1,this.renderTargetsVertical.push(w),s=Math.round(s/2),r=Math.round(r/2)}const c=Ct;this.highPassUniforms=me.clone(c.uniforms),this.highPassUniforms.luminosityThreshold.value=o,this.highPassUniforms.smoothWidth.value=.01,this.materialHighPassFilter=new $({uniforms:this.highPassUniforms,vertexShader:c.vertexShader,fragmentShader:c.fragmentShader}),this.separableBlurMaterials=[];const l=[3,5,7,9,11];s=Math.round(this.resolution.x/2),r=Math.round(this.resolution.y/2);for(let u=0;u<this.nMips;u++)this.separableBlurMaterials.push(this._getSeparableBlurMaterial(l[u])),this.separableBlurMaterials[u].uniforms.invSize.value=new C(1/s,1/r),s=Math.round(s/2),r=Math.round(r/2);this.compositeMaterial=this._getCompositeMaterial(this.nMips),this.compositeMaterial.uniforms.blurTexture1.value=this.renderTargetsVertical[0].texture,this.compositeMaterial.uniforms.blurTexture2.value=this.renderTargetsVertical[1].texture,this.compositeMaterial.uniforms.blurTexture3.value=this.renderTargetsVertical[2].texture,this.compositeMaterial.uniforms.blurTexture4.value=this.renderTargetsVertical[3].texture,this.compositeMaterial.uniforms.blurTexture5.value=this.renderTargetsVertical[4].texture,this.compositeMaterial.uniforms.bloomStrength.value=t,this.compositeMaterial.uniforms.bloomRadius.value=.1;const g=[1,.8,.6,.4,.2];this.compositeMaterial.uniforms.bloomFactors.value=g,this.bloomTintColors=[new h(1,1,1),new h(1,1,1),new h(1,1,1),new h(1,1,1),new h(1,1,1)],this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,this.copyUniforms=me.clone(pe.uniforms),this.blendMaterial=new $({uniforms:this.copyUniforms,vertexShader:pe.vertexShader,fragmentShader:pe.fragmentShader,blending:x,depthTest:!1,depthWrite:!1,transparent:!0}),this._oldClearColor=new ie,this._oldClearAlpha=1,this._basic=new M,this._fsQuad=new ye(null)}dispose(){for(let e=0;e<this.renderTargetsHorizontal.length;e++)this.renderTargetsHorizontal[e].dispose();for(let e=0;e<this.renderTargetsVertical.length;e++)this.renderTargetsVertical[e].dispose();this.renderTargetBright.dispose();for(let e=0;e<this.separableBlurMaterials.length;e++)this.separableBlurMaterials[e].dispose();this.compositeMaterial.dispose(),this.blendMaterial.dispose(),this._basic.dispose(),this._fsQuad.dispose()}setSize(e,t){let i=Math.round(e/2),o=Math.round(t/2);this.renderTargetBright.setSize(i,o);for(let s=0;s<this.nMips;s++)this.renderTargetsHorizontal[s].setSize(i,o),this.renderTargetsVertical[s].setSize(i,o),this.separableBlurMaterials[s].uniforms.invSize.value=new C(1/i,1/o),i=Math.round(i/2),o=Math.round(o/2)}render(e,t,i,o,s){e.getClearColor(this._oldClearColor),this._oldClearAlpha=e.getClearAlpha();const r=e.autoClear;e.autoClear=!1,e.setClearColor(this.clearColor,0),s&&e.state.buffers.stencil.setTest(!1),this.renderToScreen&&(this._fsQuad.material=this._basic,this._basic.map=i.texture,e.setRenderTarget(null),e.clear(),this._fsQuad.render(e)),this.highPassUniforms.tDiffuse.value=i.texture,this.highPassUniforms.luminosityThreshold.value=this.threshold,this._fsQuad.material=this.materialHighPassFilter,e.setRenderTarget(this.renderTargetBright),e.clear(),this._fsQuad.render(e);let c=this.renderTargetBright;for(let l=0;l<this.nMips;l++)this._fsQuad.material=this.separableBlurMaterials[l],this.separableBlurMaterials[l].uniforms.colorTexture.value=c.texture,this.separableBlurMaterials[l].uniforms.direction.value=j.BlurDirectionX,e.setRenderTarget(this.renderTargetsHorizontal[l]),e.clear(),this._fsQuad.render(e),this.separableBlurMaterials[l].uniforms.colorTexture.value=this.renderTargetsHorizontal[l].texture,this.separableBlurMaterials[l].uniforms.direction.value=j.BlurDirectionY,e.setRenderTarget(this.renderTargetsVertical[l]),e.clear(),this._fsQuad.render(e),c=this.renderTargetsVertical[l];this._fsQuad.material=this.compositeMaterial,this.compositeMaterial.uniforms.bloomStrength.value=this.strength,this.compositeMaterial.uniforms.bloomRadius.value=this.radius,this.compositeMaterial.uniforms.bloomTintColors.value=this.bloomTintColors,e.setRenderTarget(this.renderTargetsHorizontal[0]),e.clear(),this._fsQuad.render(e),this._fsQuad.material=this.blendMaterial,this.copyUniforms.tDiffuse.value=this.renderTargetsHorizontal[0].texture,s&&e.state.buffers.stencil.setTest(!0),this.renderToScreen?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(i),this._fsQuad.render(e)),e.setClearColor(this._oldClearColor,this._oldClearAlpha),e.autoClear=r}_getSeparableBlurMaterial(e){const t=[];for(let i=0;i<e;i++)t.push(.39894*Math.exp(-.5*i*i/(e*e))/e);return new $({defines:{KERNEL_RADIUS:e},uniforms:{colorTexture:{value:null},invSize:{value:new C(.5,.5)},direction:{value:new C(.5,.5)},gaussianCoefficients:{value:t}},vertexShader:`varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,fragmentShader:`#include <common>
				varying vec2 vUv;
				uniform sampler2D colorTexture;
				uniform vec2 invSize;
				uniform vec2 direction;
				uniform float gaussianCoefficients[KERNEL_RADIUS];

				void main() {
					float weightSum = gaussianCoefficients[0];
					vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * weightSum;
					for( int i = 1; i < KERNEL_RADIUS; i ++ ) {
						float x = float(i);
						float w = gaussianCoefficients[i];
						vec2 uvOffset = direction * invSize * x;
						vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;
						vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;
						diffuseSum += (sample1 + sample2) * w;
						weightSum += 2.0 * w;
					}
					gl_FragColor = vec4(diffuseSum/weightSum, 1.0);
				}`})}_getCompositeMaterial(e){return new $({defines:{NUM_MIPS:e},uniforms:{blurTexture1:{value:null},blurTexture2:{value:null},blurTexture3:{value:null},blurTexture4:{value:null},blurTexture5:{value:null},bloomStrength:{value:1},bloomFactors:{value:null},bloomTintColors:{value:null},bloomRadius:{value:0}},vertexShader:`varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				}`,fragmentShader:`varying vec2 vUv;
				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor(const in float factor) {
					float mirrorFactor = 1.2 - factor;
					return mix(factor, mirrorFactor, bloomRadius);
				}

				void main() {
					gl_FragColor = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
						lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
						lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
						lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
						lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );
				}`})}}j.BlurDirectionX=new C(1,0);j.BlurDirectionY=new C(0,1);const ae={name:"OutputShader",uniforms:{tDiffuse:{value:null},toneMappingExposure:{value:1}},vertexShader:`
		precision highp float;

		uniform mat4 modelViewMatrix;
		uniform mat4 projectionMatrix;

		attribute vec3 position;
		attribute vec2 uv;

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,fragmentShader:`

		precision highp float;

		uniform sampler2D tDiffuse;

		#include <tonemapping_pars_fragment>
		#include <colorspace_pars_fragment>

		varying vec2 vUv;

		void main() {

			gl_FragColor = texture2D( tDiffuse, vUv );

			// tone mapping

			#ifdef LINEAR_TONE_MAPPING

				gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );

			#elif defined( REINHARD_TONE_MAPPING )

				gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );

			#elif defined( CINEON_TONE_MAPPING )

				gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );

			#elif defined( ACES_FILMIC_TONE_MAPPING )

				gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );

			#elif defined( AGX_TONE_MAPPING )

				gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );

			#elif defined( NEUTRAL_TONE_MAPPING )

				gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );

			#elif defined( CUSTOM_TONE_MAPPING )

				gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );

			#endif

			// color space

			#ifdef SRGB_TRANSFER

				gl_FragColor = sRGBTransferOETF( gl_FragColor );

			#endif

		}`};class St extends Z{constructor(){super(),this.uniforms=me.clone(ae.uniforms),this.material=new qe({name:ae.name,uniforms:this.uniforms,vertexShader:ae.vertexShader,fragmentShader:ae.fragmentShader}),this._fsQuad=new ye(this.material),this._outputColorSpace=null,this._toneMapping=null}render(e,t,i){this.uniforms.tDiffuse.value=i.texture,this.uniforms.toneMappingExposure.value=e.toneMappingExposure,(this._outputColorSpace!==e.outputColorSpace||this._toneMapping!==e.toneMapping)&&(this._outputColorSpace=e.outputColorSpace,this._toneMapping=e.toneMapping,this.material.defines={},Xe.getTransfer(this._outputColorSpace)===$e&&(this.material.defines.SRGB_TRANSFER=""),this._toneMapping===je?this.material.defines.LINEAR_TONE_MAPPING="":this._toneMapping===Ze?this.material.defines.REINHARD_TONE_MAPPING="":this._toneMapping===Je?this.material.defines.CINEON_TONE_MAPPING="":this._toneMapping===Le?this.material.defines.ACES_FILMIC_TONE_MAPPING="":this._toneMapping===et?this.material.defines.AGX_TONE_MAPPING="":this._toneMapping===tt?this.material.defines.NEUTRAL_TONE_MAPPING="":this._toneMapping===st&&(this.material.defines.CUSTOM_TONE_MAPPING=""),this.material.needsUpdate=!0),this.renderToScreen===!0?(e.setRenderTarget(null),this._fsQuad.render(e)):(e.setRenderTarget(t),this.clear&&e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil),this._fsQuad.render(e))}dispose(){this.material.dispose(),this._fsQuad.dispose()}}const re=13172502;function yt(){const n=new A,e=[],t=[],i=new Ce({color:11186874,metalness:.96,roughness:.17,clearcoat:1,clearcoatRoughness:.07,envMapIntensity:1.6}),o=new H({color:724239,metalness:.7,roughness:.42,envMapIntensity:.8}),s=new Ce({color:263946,metalness:.9,roughness:.03,clearcoat:1,clearcoatRoughness:.02,envMapIntensity:2.2,transparent:!0,opacity:.42,depthWrite:!1}),r=new M({color:re}),c=new M({color:re,transparent:!0,opacity:.55,blending:x,depthWrite:!1}),l=new M({color:15925216}),g=new H({color:10133928,metalness:1,roughness:.25}),u=new H({color:460808,metalness:.1,roughness:.92}),f=new De;f.moveTo(-2.34,.2),f.lineTo(2.08,.2),f.quadraticCurveTo(2.38,.21,2.36,.38),f.quadraticCurveTo(2.16,.58,1.68,.63),f.quadraticCurveTo(1.12,.69,.82,.73),f.lineTo(-1.32,.76),f.quadraticCurveTo(-1.98,.8,-2.3,.73),f.lineTo(-2.38,.44),f.quadraticCurveTo(-2.38,.2,-2.08,.2);const w=new Fe(f,{depth:1.62,bevelEnabled:!0,bevelSegments:5,bevelSize:.1,bevelThickness:.12,curveSegments:22});w.translate(0,0,-.81),w.rotateY(-Math.PI/2);const P=new a(w,i);n.add(P);const T=new De;T.moveTo(-1.34,.72),T.quadraticCurveTo(-1.08,1.04,-.62,1.16),T.quadraticCurveTo(.28,1.2,1.06,.78),T.lineTo(1.17,.7),T.lineTo(-1.34,.72);const _=new Fe(T,{depth:1.2,bevelEnabled:!0,bevelSegments:4,bevelSize:.055,bevelThickness:.055,curveSegments:20});_.translate(0,0,-.6),_.rotateY(-Math.PI/2);const k=new a(_,s);n.add(k);const J=new a(new y(.035,.012,1.2),c);J.position.set(0,1.185,-.38),n.add(J);const N=new a(new b(1.92,.055,.5,3,.02),o);N.position.set(0,.155,2.16),n.add(N);for(const d of[-1,1]){const p=new a(new b(.34,.025,.16,2,.01),o);p.position.set(d*.76,.34,1.94),p.rotation.z=d*.12,n.add(p)}for(const d of[-1,1]){const p=new a(new b(.09,.06,2.5,3,.02),o);p.position.set(d*.9,.18,0),n.add(p);const m=new a(new y(.012,.022,2.2),r);m.position.set(d*.952,.205,0),n.add(m)}const I=new a(new b(1.54,.06,.42,3,.025),o);I.position.set(0,1.08,-2.04),I.rotation.x=-.08,n.add(I);for(const d of[-1,1]){const p=new a(new b(.055,.34,.15,3,.02),o);p.position.set(d*.56,.9,-2.02),n.add(p);const m=new a(new b(.02,.2,.5,2,.01),o);m.position.set(d*.79,1.06,-2.04),n.add(m)}const V=new a(new y(1.4,.008,.02),c);V.position.set(0,1.04,-2.24),n.add(V);const Q=new a(new y(1.5,.035,.02),r);Q.position.set(0,.68,-2.38),n.add(Q);const L=new a(new y(1.7,.14,.02),new M({color:re,transparent:!0,opacity:.16,blending:x,depthWrite:!1}));L.position.set(0,.68,-2.39),n.add(L);for(const d of[-1,1]){const p=new a(new z(.085,.085,.18,20),g);p.rotation.x=Math.PI/2,p.position.set(d*.4,.33,-2.3),n.add(p);const m=new a(new z(.065,.065,.19,20),new M({color:131586}));m.rotation.x=Math.PI/2,m.position.set(d*.4,.33,-2.31),n.add(m)}for(let d=0;d<7;d++){const p=new a(new b(.015,.13,.32,2,.005),o);p.position.set(-.6+d*.2,.17,-2.22),n.add(p)}for(const d of[-1,1]){const p=new a(new b(.4,.055,.035,3,.015),l);p.position.set(d*.52,.47,2.3),p.rotation.x=-.22,n.add(p);const m=new a(new y(.58,.16,.02),new M({color:15400896,transparent:!0,opacity:.22,blending:x,depthWrite:!1}));m.position.set(d*.52,.47,2.32),n.add(m)}for(const d of[-1,1]){const p=new a(new b(.3,.015,.42,2,.01),o);p.position.set(d*.44,.685,1.36),p.rotation.x=-.06,n.add(p)}const v=new A;for(const d of[-1,1]){const p=new a(new b(.4,.09,.46,3,.04),o);p.position.set(d*.34,.6,.08),v.add(p);const m=new a(new b(.4,.5,.1,3,.04),o);m.position.set(d*.34,.82,-.16),m.rotation.x=-.22,v.add(m);const te=new a(new b(.03,.32,.34,2,.012),c);te.position.set(d*.15,.66,.02),v.add(te);const W=new a(new y(.07,.5,.01),c);W.position.set(d*.4,.81,.04),W.rotation.z=d*.28,W.rotation.x=-.2,v.add(W)}const S=new a(new b(1.16,.1,.18,3,.03),o);S.position.set(0,.74,.5),S.rotation.x=.18,v.add(S);const D=new a(new oe(.26,.08),c);D.position.set(-.34,.79,.43),D.rotation.x=-.6,v.add(D);const F=new a(new R(.13,.016,8,28),o);F.position.set(-.34,.76,.34),F.rotation.x=-.42,v.add(F);const Y=new a(new y(.22,.02,.02),g);Y.position.copy(F.position),Y.rotation.copy(F.rotation),v.add(Y);const O=new a(new R(.5,.025,8,24,Math.PI),g);O.position.set(0,.72,-.42),O.rotation.z=Math.PI,O.rotation.x=-.1,v.add(O),n.add(v);const G=it();G.group.scale.setScalar(.46),G.group.position.set(0,.78,-1.52),n.add(G.group);const ne=new a(new b(.94,.06,1.02,3,.03),o);ne.position.set(0,.87,-1.5),n.add(ne);const ee=new a(new b(.86,.26,.92,3,.06),s);ee.position.set(0,1.02,-1.5),n.add(ee);for(const d of[-1,1]){const p=new a(new y(.015,.02,.94),r);p.position.set(d*.42,1.15,-1.5),n.add(p)}const _e=new a(new y(.62,.012,.03),o);_e.position.set(0,1.16,-1.92),n.add(_e);for(const d of[-1,1]){const p=new a(new y(.16,.02,.02),o);p.position.set(d*.98,.84,.66),n.add(p);const m=new a(new b(.1,.065,.16,2,.015),i);m.position.set(d*1.08,.86,.66),n.add(m)}const ge=new a(new oe(3.6,5.6),new M({color:re,transparent:!0,opacity:.05,blending:x,depthWrite:!1}));ge.rotation.x=-Math.PI/2,ge.position.y=.025,n.add(ge);const Pe=[[-1,1.36],[1,1.36],[-1,-1.42],[1,-1.42]];for(const[d,p]of Pe){const m=new A;m.position.set(d*.93,.46,p);const te=new z(.47,.47,.33,44,1);te.rotateZ(Math.PI/2),m.add(new a(te,u));const W=new z(.3,.3,.35,36);W.rotateZ(Math.PI/2);const Qe=new a(W,o);m.add(Qe);const Re=new R(.3,.018,8,40);Re.rotateY(Math.PI/2);const Ee=new a(Re,g);Ee.position.x=d*.17,m.add(Ee);const Ae=new z(.22,.22,.018,30);Ae.rotateZ(Math.PI/2);const ke=new a(Ae,g);ke.position.x=d*.02,m.add(ke);const Ie=new a(new b(.055,.16,.1,2,.015),r);Ie.position.set(d*.06,.17,.08),m.add(Ie);for(let we=0;we<7;we++){const ve=new a(new y(.045,.5,.055),g);ve.rotation.x=we/7*Math.PI*2,ve.position.x=d*.15,m.add(ve)}n.add(m),e.push(m)}for(const[d,p]of Pe){const m=new a(new R(.53,.055,8,34,Math.PI*.94),i);m.rotation.y=Math.PI/2,m.position.set(d*.9,.47,p),n.add(m)}return t.push({id:"car-aero",index:"A-01",label:"ACTIVE AERO",value:"1,240 KG DOWNFORCE",position:new h(.7,1.16,-2)},{id:"car-sprint",index:"A-02",label:"0–100 TOKENS",value:"0.14 SEC",position:new h(-.87,.52,1.32)},{id:"car-core",index:"A-03",label:"INFERENCE CORE",value:"LOCAL / 32K",position:new h(.6,.82,.1)},{id:"car-v12",index:"A-04",label:"V12 BITURBO",value:"6.5L / 48 VALVES",position:new h(0,1.14,-1.5)}),{group:n,wheels:e,anchors:t,engine:G}}const Te=13172502;function K(n,e,t,i){const o=n.distanceTo(e),s=new z(t,t,o,8);s.translate(0,o/2,0);const r=new a(s,i);return r.position.copy(n),r.quaternion.setFromUnitVectors(new h(0,1,0),e.clone().sub(n).normalize()),r}function le(n,e,t=28){const i=new X(new at(n.geometry,t),e);return n.add(i),n}function _t(){const n=document.createElement("canvas");n.width=128,n.height=128;const e=n.getContext("2d"),t=e.createRadialGradient(64,64,0,64,64,64);t.addColorStop(0,"rgba(200,255,22,0.9)"),t.addColorStop(.45,"rgba(200,255,22,0.25)"),t.addColorStop(1,"rgba(200,255,22,0)"),e.fillStyle=t,e.fillRect(0,0,128,128);const i=new We(n);return i.colorSpace=He,i}function Pt(){const n=new A,e=[],t=new H({color:1185048,metalness:.82,roughness:.3,envMapIntensity:.9}),i=new ue({color:Te,transparent:!0,opacity:.85}),o=new H({color:10989752,metalness:1,roughness:.22}),s=new M({color:Te}),r=new H({color:526601,metalness:.15,roughness:.9}),c=new Ce({color:329995,metalness:.85,roughness:.04,clearcoat:1,envMapIntensity:2});for(const v of[1.02,-.98]){const S=new A;S.position.set(0,.56,v);const D=new R(.54,.075,12,52);D.rotateY(Math.PI/2),S.add(new a(D,r));const F=new R(.615,.006,4,64);F.rotateY(Math.PI/2),S.add(new a(F,s));const Y=new R(.3,.014,6,44);Y.rotateY(Math.PI/2),S.add(new a(Y,s));const O=new a(new z(.07,.07,.13,16),o);O.rotation.z=Math.PI/2,S.add(O);for(let G=0;G<8;G++){const ne=G/8*Math.PI*2,ee=new a(new y(.012,.56,.012),o);ee.rotation.x=ne,S.add(ee)}n.add(S)}const l=new A,g=[[new h(.13,1.12,.72),new h(.13,.56,1.03),.026],[new h(-.13,1.12,.72),new h(-.13,.56,1.03),.026],[new h(.14,.58,-.98),new h(.14,.68,-.08),.03],[new h(-.14,.58,-.98),new h(-.14,.68,-.08),.03],[new h(.14,.62,-.1),new h(.14,1.02,-.64),.022],[new h(-.14,.62,-.1),new h(-.14,1.02,-.64),.022],[new h(.12,.7,.1),new h(.12,.85,.92),.02],[new h(-.12,.7,.1),new h(-.12,.85,.92),.02]];for(const[v,S,D]of g)l.add(K(v,S,D,o));const u=K(new h(-.34,1.19,.62),new h(.34,1.19,.62),.018,o);l.add(u);const f=K(new h(0,.62,-.28),new h(0,1,-.56),.035,s);l.add(f);const w=K(new h(.24,.62,-.2),new h(.33,.78,-1.02),.055,o);l.add(w);const P=new a(new z(.075,.06,.16,18),s);P.position.set(.33,.79,-1.06),P.rotation.x=Math.PI/2,l.add(P),n.add(l);const T=le(new a(new Ge(1,28,18),t),i,32);T.scale.set(.34,.27,.56),T.position.set(0,1,.32),n.add(T);const _=le(new a(new Ge(1,24,16,0,Math.PI*2,0,Math.PI*.62),t),i,26);_.scale.set(.32,.34,.46),_.position.set(0,1,.8),_.rotation.x=.16,n.add(_);const k=new a(new oe(.4,.28),c);k.position.set(0,1.28,.86),k.rotation.x=-.66,n.add(k);const J=le(new a(new b(.28,.09,.62,3,.025),t),i,32);J.position.set(0,1.055,-.48),n.add(J);const N=le(new a(new ot(.16,.55,4),t),i,24);N.rotation.x=Math.PI/2,N.rotation.z=Math.PI/4,N.position.set(0,1.06,-1.05),n.add(N);const I=nt();I.group.scale.setScalar(.5),I.group.position.set(0,.55,.08),n.add(I.group);for(const v of[-1,1])n.add(K(new h(v*.24,.84,.38),new h(v*.24,.44,.38),.013,o)),n.add(K(new h(v*.24,.44,.38),new h(v*.24,.44,-.2),.013,o));const V=new a(new Oe(.09,24),s);V.position.set(0,1.04,1.16),V.rotation.x=-.2,n.add(V);const Q=new a(new R(.82,.004,3,72),new M({color:15138768,transparent:!0,opacity:.22,blending:x,depthWrite:!1}));Q.rotation.y=Math.PI/2,Q.position.set(0,.95,0),n.add(Q);const L=new a(new oe(2.6,3.4),new M({map:_t(),color:Te,transparent:!0,opacity:.55,blending:x,depthWrite:!1,side:Se}));return L.rotation.x=-Math.PI/2,L.position.y=.02,n.add(L),e.push({id:"bike-power",index:"B-01",label:"OUTPUT",value:"210 HP / 32K CTX",position:new h(.2,1.15,.32)},{id:"bike-mass",index:"B-02",label:"DRY MASS",value:"186 KG",position:new h(.22,.7,.12)},{id:"bike-aero",index:"B-03",label:"AERO SHELL",value:"0.21 CD",position:new h(.18,1.14,.86)},{id:"bike-dohc",index:"B-04",label:"DOHC / 16V",value:"IN-LINE FOUR",position:new h(0,.92,.08)}),{group:n,scan:L,anchors:e,engine:I}}const B=13172502;function he(){const n=window.devicePixelRatio||1,e=navigator.hardwareConcurrency;return Math.min(n,e&&e<=4?1.5:2)}const U=[{p:0,pos:[7.4,2,9.2],tgt:[0,.62,0],fov:40},{p:.12,pos:[3.5,1.12,6.5],tgt:[0,.62,0],fov:40},{p:.25,pos:[-5.4,1.9,5.8],tgt:[-.4,.68,0],fov:41},{p:.35,pos:[-5.8,1.8,-.7],tgt:[-9,.86,-6],fov:38},{p:.45,pos:[-11.6,2.5,-3.3],tgt:[-9,.82,-6],fov:36},{p:.56,pos:[-3.2,2,3.4],tgt:[-2.2,.62,-2.4],fov:42},{p:.68,pos:[.2,6.8,14.5],tgt:[-.4,.2,-3],fov:46},{p:.8,pos:[0,2.7,6.4],tgt:[0,3,-34],fov:48},{p:.9,pos:[0,3.9,-12],tgt:[0,4.7,-62],fov:55},{p:1,pos:[0,4.7,-30],tgt:[0,4.7,-96],fov:62}],Rt={uniforms:{tDiffuse:{value:null},uTime:{value:0},uAberration:{value:1},uRes:{value:new C(1,1)}},vertexShader:`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float dist = length(dir);
      float ab = (0.0005 + 0.0018 * uAberration) * (0.6 + dist);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      float scan = sin(uv.y * uRes.y * 1.6 + uTime * 1.4);
      col *= 1.0 - 0.015 * scan;

      float grain = hash(uv * uRes.xy + uTime * 60.0) - 0.5;
      col += grain * 0.022;

      col *= smoothstep(1.18, 0.3, dist);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `};function q(n){const e=Math.min(1,Math.max(0,n));return e*e*(3-2*e)}function Et(){const n=document.createElement("canvas");n.width=256,n.height=256;const e=n.getContext("2d"),t=e.createRadialGradient(128,128,0,128,128,128);t.addColorStop(0,"rgba(200,255,22,0.55)"),t.addColorStop(.3,"rgba(200,255,22,0.13)"),t.addColorStop(1,"rgba(200,255,22,0)"),e.fillStyle=t,e.fillRect(0,0,256,256);const i=new We(n);return i.colorSpace=He,i}class kt{renderer;scene;camera;composer;crt;clock=new Ne;raf=0;car;bike;carGroup=new A;bikeGroup=new A;anchors=[];labels=new Map;labelsEl;streaks;streakSpeeds;streakPositions;dust;tunnel;endRing;progress=0;targetProgress=0;pointer=new C;pointerTarget=new C;clockTime=0;reducedMotion;disposed=!1;lastCameraPos=new h;basePos=new h;baseTarget=new h;lookTarget=new h;onReady;readySent=!1;paused=!1;constructor(e,t,i){this.labelsEl=t,this.onReady=i,this.reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches,this.renderer=new rt({canvas:e,antialias:!0,powerPreference:"high-performance"}),this.renderer.setPixelRatio(he()),this.renderer.setSize(window.innerWidth,window.innerHeight),this.renderer.toneMapping=Le,this.renderer.toneMappingExposure=1.05,this.scene=new lt,this.scene.background=new ie(329223),this.scene.fog=new ht(329223,.017),this.camera=new ct(40,window.innerWidth/window.innerHeight,.1,300),this.camera.position.set(7.4,2,9.2);const o=new dt(this.renderer),s=new ut;this.scene.environment=o.fromScene(s,.04).texture,s.dispose(),o.dispose(),this.buildLights(),this.buildGround(),this.car=yt(),this.carGroup.add(this.car.group),this.scene.add(this.carGroup),this.bike=Pt(),this.bikeGroup.add(this.bike.group),this.bikeGroup.position.set(-9,0,-6),this.bikeGroup.rotation.y=.18,this.scene.add(this.bikeGroup),this.anchors=[...this.car.anchors.map(u=>({...u,group:this.carGroup})),...this.bike.anchors.map(u=>({...u,group:this.bikeGroup}))],this.labelsEl.querySelectorAll("[data-anchor]").forEach(u=>this.labels.set(u.dataset.anchor,u));const r=this.buildStreaks();this.streaks=r.mesh,this.streakSpeeds=r.speeds,this.streakPositions=r.positions,this.scene.add(this.streaks),this.dust=this.buildDust(),this.scene.add(this.dust);const c=this.buildTunnel();this.tunnel=c.group,this.endRing=c.endRing,this.tunnel.visible=!1,this.scene.add(this.tunnel);const l=new a(new oe(26,26),new M({map:Et(),transparent:!0,opacity:.22,blending:x,depthWrite:!1,fog:!1}));l.position.set(0,4.6,-112),this.scene.add(l),this.composer=new xt(this.renderer),this.composer.setPixelRatio(he()),this.composer.setSize(window.innerWidth,window.innerHeight),this.composer.addPass(new Tt(this.scene,this.camera));const g=new j(new C(window.innerWidth,window.innerHeight),.62,.62,.82);this.composer.addPass(g),this.crt=new Ve(Rt),this.composer.addPass(this.crt),this.composer.addPass(new St),this.onScroll=this.onScroll.bind(this),this.onPointer=this.onPointer.bind(this),this.onResize=this.onResize.bind(this),window.addEventListener("scroll",this.onScroll,{passive:!0}),window.addEventListener("pointermove",this.onPointer,{passive:!0}),window.addEventListener("resize",this.onResize),this.onScroll(),this.progress=this.targetProgress,this.lastCameraPos.copy(this.camera.position),this.tick()}buildLights(){const e=new pt(10466493,329223,.7);this.scene.add(e);const t=new be(16777215,2.1);t.position.set(6,9,5),this.scene.add(t);const i=new be(9681112,1.7);i.position.set(-7,4,-9),this.scene.add(i);const o=new be(B,1.35);o.position.set(-5,2,4),this.scene.add(o);const s=new Me(B,16,6,2);s.position.set(0,.15,0),this.scene.add(s);const r=new Me(B,12,8,2);r.position.set(-9,.6,-4),this.scene.add(r);const c=new Me(14677503,22,20,2);c.position.set(0,4.5,-12),this.scene.add(c)}buildGround(){const e=new ft(240,240,1911318,1120019);e.position.y=.002;const t=e.material;t.transparent=!0,t.opacity=.5,this.scene.add(e);const i=new a(new Oe(60,64),new H({color:461065,metalness:.85,roughness:.3,envMapIntensity:.35}));i.rotation.x=-Math.PI/2,i.position.y=-.01,this.scene.add(i),[3.2,5.2,5.205,6.6,9.4,14.2].forEach((g,u)=>{const f=new a(new Be(g,g+(u===2?.024:.008),128),new M({color:u===2?B:11451827,transparent:!0,opacity:u===2?.7:.14,blending:x,side:Se,depthWrite:!1,fog:!1}));f.rotation.x=-Math.PI/2,f.position.y=.012,this.scene.add(f)});const s=new se,r=[];for(let g=0;g<120;g++){const u=g/120*Math.PI*2,f=5.24,w=g%10===0?5.5:5.36;r.push(Math.cos(u)*f,.014,Math.sin(u)*f),r.push(Math.cos(u)*w,.014,Math.sin(u)*w)}s.setAttribute("position",new fe(r,3));const c=new X(s,new ue({color:14214870,transparent:!0,opacity:.3,fog:!1}));this.scene.add(c);const l=new a(new Be(2.02,2.16,96),new M({color:B,transparent:!0,opacity:.36,blending:x,side:Se,depthWrite:!1,fog:!1}));l.rotation.x=-Math.PI/2,l.position.set(-9,.014,-6),this.scene.add(l)}buildStreaks(){const e=this.reducedMotion?70:360,t=new Float32Array(e*6),i=new Float32Array(e*6),o=new Float32Array(e);for(let l=0;l<e;l++){const g=Math.random()*Math.PI*2,u=3.4+Math.random()*13,f=Math.cos(g)*u,w=Math.random()*7.5+.1,P=-95+Math.random()*115,T=.8+Math.random()*3.4;t.set([f,w,P,f,w,P+T],l*6);const k=Math.random()>.72?[.78,1,.09]:[.66,.74,.7];i.set([...k,...k],l*6),o[l]=12+Math.random()*42}const s=new se;s.setAttribute("position",new xe(t,3)),s.setAttribute("color",new xe(i,3));const r=new ue({vertexColors:!0,transparent:!0,opacity:.3,blending:x,depthWrite:!1});return{mesh:new X(s,r),speeds:o,positions:t}}buildDust(){const e=this.reducedMotion?300:1100,t=new Float32Array(e*3);for(let s=0;s<e;s++)t[s*3]=(Math.random()-.5)*40,t[s*3+1]=Math.random()*12,t[s*3+2]=-80+Math.random()*100;const i=new se;i.setAttribute("position",new xe(t,3));const o=new mt({color:12111028,size:.035,transparent:!0,opacity:.35,blending:x,depthWrite:!1,sizeAttenuation:!0});return new Ue(i,o)}buildTunnel(){const e=new A;for(let s=0;s<22;s++){const r=3.9+s*.14,c=new a(new R(r,.013+(s%5===0?.012:0),4,96),new M({color:s%6===0?16777215:B,transparent:!0,opacity:.3,blending:x,depthWrite:!1,fog:!1}));c.position.set(0,5,-24-s*4.1),e.add(c)}const t=new se,i=[];for(const s of[-5.2,5.2])i.push(s,.03,-18,s,.03,-112);t.setAttribute("position",new fe(i,3)),e.add(new X(t,new ue({color:B,transparent:!0,opacity:.35,blending:x,fog:!1})));const o=new a(new R(11,.06,8,128),new M({color:B,transparent:!0,opacity:.7,blending:x,depthWrite:!1,fog:!1}));return o.position.set(0,5,-118),e.add(o),{group:e,endRing:o}}onScroll(){const e=Math.max(1,document.documentElement.scrollHeight-window.innerHeight);this.targetProgress=Math.min(1,Math.max(0,window.scrollY/e))}onPointer(e){this.pointerTarget.set(e.clientX/window.innerWidth*2-1,e.clientY/window.innerHeight*2-1)}onResize(){const e=window.innerWidth,t=window.innerHeight;this.camera.aspect=e/t,this.camera.updateProjectionMatrix(),this.renderer.setPixelRatio(he()),this.renderer.setSize(e,t),this.composer.setPixelRatio(he()),this.composer.setSize(e,t),this.crt.uniforms.uRes.value.set(e,t)}sampleCamera(e){let t=U[0],i=U[U.length-1];for(let l=0;l<U.length-1;l++)if(e>=U[l].p&&e<=U[l+1].p){t=U[l],i=U[l+1];break}const o=i.p===t.p?0:(e-t.p)/(i.p-t.p),s=q(o);this.basePos.set(E.lerp(t.pos[0],i.pos[0],s),E.lerp(t.pos[1],i.pos[1],s),E.lerp(t.pos[2],i.pos[2],s)),this.baseTarget.set(E.lerp(t.tgt[0],i.tgt[0],s),E.lerp(t.tgt[1],i.tgt[1],s),E.lerp(t.tgt[2],i.tgt[2],s));const r=this.camera.aspect<.9;r&&(this.basePos.sub(this.baseTarget).multiplyScalar(1.16).add(this.baseTarget),this.basePos.y+=.2);const c=E.lerp(t.fov,i.fov,s)+(r?9:0);this.camera.fov+=(c-this.camera.fov)*.08,this.camera.updateProjectionMatrix()}updateLabels(e){const t=new h;for(const i of this.anchors){const o=this.labels.get(i.id);if(!o)continue;const r=i.id.startsWith("bike")?[.28,.52]:[.005,.31],c=q((e-r[0])/.03),l=1-q((e-r[1])/.03),g=Math.min(c,l);t.copy(i.position),i.group.localToWorld(t);const u=t.clone();t.project(this.camera);const f=(t.x*.5+.5)*window.innerWidth,w=(-t.y*.5+.5)*window.innerHeight,P=t.z<1&&t.z>-1,T=f>0&&f<window.innerWidth&&w>0&&w<window.innerHeight,_=g>.01&&P&&T;o.style.opacity=_?String(g):"0",o.style.transform=`translate3d(${f}px, ${w}px, 0) translate(-50%, -50%)`,o.style.setProperty("--leader",String(Math.min(1,Math.max(0,t.z)))),o.dataset.world=`${u.x.toFixed(1)},${u.y.toFixed(1)}`}}setPaused(e){this.paused=e,e||this.clock.getDelta()}tick=()=>{if(this.disposed||(this.raf=requestAnimationFrame(this.tick),this.paused))return;const e=Math.min(.05,this.clock.getDelta());this.clockTime+=e,this.pointer.lerp(this.pointerTarget,.05),this.progress+=(this.targetProgress-this.progress)*Math.min(1,e*6);const t=this.progress;this.sampleCamera(t),this.camera.position.copy(this.basePos),this.camera.position.x+=this.pointer.x*.55,this.camera.position.y+=this.pointer.y*-.28,this.lookTarget.copy(this.baseTarget),this.lookTarget.x+=this.pointer.x*.35,this.lookTarget.y+=this.pointer.y*-.18,this.camera.lookAt(this.lookTarget),this.carGroup.rotation.y=Math.sin(this.clockTime*.08)*.012;for(const o of this.car.wheels)o.rotation.x+=e*.55;if(this.car.engine.update(this.clockTime),this.bike.engine.update(this.clockTime),this.bikeGroup.position.y=Math.sin(this.clockTime*.6)*.008,this.bike.scan.position.y=.35+this.clockTime*.42%1.4,this.bike.scan.material.opacity=.16+.3*Math.abs(Math.sin(this.clockTime*.42*Math.PI%1)),this.bike.scan.visible=t>.24&&t<.56,t>.58){this.tunnel.visible=!0;const o=q((t-.58)/.22);this.tunnel.children.forEach(s=>{if(s instanceof a||s instanceof X){const r=s.material;"opacity"in r&&(r.opacity=o*.34)}}),this.endRing.material.opacity=.25+.55*q((t-.85)/.15),this.scene.fog.density=E.lerp(.017,.004,q((t-.62)/.3))}else this.tunnel.visible=!1;if(!this.reducedMotion){const o=this.streakPositions;for(let s=0;s<this.streakSpeeds.length;s++){const r=this.streakSpeeds[s]*e;if(o[s*6+2]+=r,o[s*6+5]+=r,o[s*6+2]>34){const c=Math.random()*Math.PI*2,l=3.4+Math.random()*13,g=Math.cos(c)*l,u=Math.random()*7.5+.1,f=-95,w=.8+Math.random()*3.4;o.set([g,u,f,g,u,f+w],s*6)}}this.streaks.geometry.attributes.position.needsUpdate=!0,this.dust.rotation.y+=e*.004,this.dust.position.y=Math.sin(this.clockTime*.1)*.15}const i=this.camera.position.distanceTo(this.lastCameraPos)/Math.max(e,.001);this.lastCameraPos.copy(this.camera.position),this.crt.uniforms.uTime.value=this.clockTime,this.crt.uniforms.uAberration.value=E.lerp(this.crt.uniforms.uAberration.value,1+Math.min(i*.16,6),.1),this.updateLabels(t),this.composer.render(),this.readySent||(this.readySent=!0,this.onReady?.())};dispose(){this.disposed=!0,cancelAnimationFrame(this.raf),window.removeEventListener("scroll",this.onScroll),window.removeEventListener("pointermove",this.onPointer),window.removeEventListener("resize",this.onResize),this.scene.traverse(e=>{(e instanceof a||e instanceof X||e instanceof Ue)&&(e.geometry?.dispose(),(Array.isArray(e.material)?e.material:[e.material]).forEach(i=>{"map"in i&&i.map instanceof gt&&i.map.dispose(),i.dispose()}))}),this.renderer.dispose(),this.composer.dispose()}}export{kt as ApexEngine};
