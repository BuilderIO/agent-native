# Third-party notices

The macOS app links [transcribe.cpp](https://github.com/handy-computer/transcribe.cpp)
0.4.1 for on-device transcription with Whisper and Parakeet. It builds ggml,
miniz and Silero VAD's segmentation code into the same native library. Model
files are downloaded at runtime and are not part of the app; the notices and
licenses for Silero VAD and Parakeet follow because the app downloads and runs
them.

## transcribe.cpp

```
MIT License

Copyright (c) 2026 The transcribe.cpp authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ggml

```
MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## miniz

```
Copyright 2013-2014 RAD Game Tools and Valve Software
Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC

All Rights Reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Silero VAD

transcribe.cpp builds Silero VAD's segmentation code into the native library,
and Clips downloads the F32 GGUF conversion of the Silero VAD v6.2 weights
([handy-computer/silero-vad-v6.2-gguf](https://huggingface.co/handy-computer/silero-vad-v6.2-gguf))
to tell a silent dictation from speech.

```
Modifications: handy-computer converted https://github.com/snakers4/silero-vad
at commit 5cd7945 to GGUF for transcribe.cpp
(https://github.com/handy-computer/transcribe.cpp). Conversion repackages the
weights, renaming and re-laying-out tensors. The weights were not retrained or
fine-tuned.
```

```
MIT License

Copyright (c) 2020-present Silero Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Parakeet Unified English 0.6B

Clips downloads the Q8_0 GGUF conversion of
[nvidia/parakeet-unified-en-0.6b](https://huggingface.co/nvidia/parakeet-unified-en-0.6b)
for on-device English dictation and meeting transcription.

```
Licensed by NVIDIA Corporation under the NVIDIA Open Model License

Modifications: handy-computer converted
https://huggingface.co/nvidia/parakeet-unified-en-0.6b at commit d4ac992 to
GGUF for transcribe.cpp (https://github.com/handy-computer/transcribe.cpp).
Conversion repackages the weights, renaming and re-laying-out tensors; the
quantized files (Q8_0, Q6_K, Q5_K_M, Q4_K_M) also store them at reduced
numeric precision. The weights were not retrained or fine-tuned.
```

```
NVIDIA Open Model License Agreement, as published at
https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/
(retrieved 2026-10-16). Reproduced verbatim; the published page is authoritative.
Section numbers are rendered by that page's stylesheet and reproduced here.

NVIDIA Open Model License Agreement

IMPORTANT NOTICE – PLEASE READ AND AGREE BEFORE USING THE NVIDIA MODELS.

Last Modified: October 24, 2025

This NVIDIA Open Model License Agreement (the “Agreement”) is a legal agreement between the Legal Entity You represent, or if no entity is identified, You and NVIDIA Corporation and its Affiliates (“NVIDIA”) and governs Your use of the Models that NVIDIA provides to You under this Agreement. NVIDIA and You are each a “party” and collectively the “parties.”

NVIDIA models released under this Agreement are intended to be used permissively and enable the further development of AI technologies. Subject to the terms of this Agreement, NVIDIA confirms that:

- Models are commercially usable.

- You are free to create and distribute Derivative Models.

- NVIDIA does not claim ownership to any outputs generated using the Models or Derivative Models.

By using, reproducing, modifying, distributing, performing or displaying any portion or element of the Model or Derivative Model, or otherwise accepting the terms of this Agreement, you agree to be bound by this Agreement.

1. Definitions. The following definitions apply to this Agreement:

1.1 "Derivative Model" means all (a) modifications to the Model, (b) works based on the Model, and (c) any other derivative works of the Model. An output is not a Derivative Model.

1.2 "Legal Entity" means the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (a) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (b) ownership of fifty percent (50%) or more of the outstanding shares, or (c) beneficial ownership of such entity.

1.3 “Model” means the machine learning model, software, checkpoints, learnt weights, algorithms, parameters, configuration files and documentation shared under this Agreement.

1.4 "NVIDIA Cosmos Model" means a multimodal Model shared under this Agreement

1.5 "Special-Purpose Model" means a Model that is only competent in a narrow set of purpose-specific tasks and should not be used for unintended or general-purpose applications

1.6 “You” or “Your” means an individual or Legal Entity exercising permissions granted by this Agreement.

2. Conditions for Use, License Grant, AI Ethics and IP Ownership.

2.1 Conditions for Use. The Model and any Derivative Model are subject to additional terms as described in Section 2 and Section 3 of this Agreement and govern Your use. If You institute copyright or patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Model or a Derivative Model constitutes direct or contributory copyright or patent infringement, then any licenses granted to You under this Agreement for that Model or Derivative Model will terminate as of the date such litigation is filed. If You bypass, disable, reduce the efficacy of, or circumvent any technical limitation, safety guardrail or associated safety guardrail hyperparameter, encryption, security, digital rights management, or authentication mechanism (collectively “Guardrail”) contained in the Model without a substantially similar Guardrail appropriate for your use case, your rights under this Agreement will automatically terminate. NVIDIA may indicate in relevant documentation that a Model is a Special-Purpose Model. NVIDIA may update this Agreement to comply with legal and regulatory requirements at any time and You agree to either comply with any updated license or cease Your copying, use, and distribution of the Model and any Derivative Model.

2.2 License Grant. The rights granted herein are explicitly conditioned on Your full compliance with the terms of this Agreement. Subject to the terms and conditions of this Agreement, NVIDIA hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, revocable (as stated in Section 2.1) license to publicly perform, publicly display, reproduce, use, create derivative works of, make, have made, sell, offer for sale, distribute (through multiple tiers of distribution) and import the Model.

2.3 AI Ethics. Use of the Models under the Agreement must be consistent with NVIDIA’s Trustworthy AI terms found at https://www.nvidia.com/en-us/agreements/trustworthy-ai/terms/.

2.4 NVIDIA owns the Model and any Derivative Models created by NVIDIA. Subject to NVIDIA’s underlying ownership rights in the Model or its Derivative Models, You are and will be the owner of Your Derivative Models. NVIDIA claims no ownership rights in outputs. You are responsible for outputs and their subsequent uses. Except as expressly granted in this Agreement, (a) NVIDIA reserves all rights, interests and remedies in connection with the Model and (b) no other license or right is granted to you by implication, estoppel or otherwise.

3. Redistribution. You may reproduce and distribute copies of the Model or Derivative Models thereof in any medium, with or without modifications, provided that You meet the following conditions:

3.1 If you distribute the Model, You must give any other recipients of the Model a copy of this Agreement and include the following attribution notice within a “Notice” text file with such copies: “Licensed by NVIDIA Corporation under the NVIDIA Open Model License”;

3.2 If you distribute or make available a NVIDIA Cosmos Model, or a product or service (including an AI model) that contains or uses a NVIDIA Cosmos Model, use a NVIDIA Cosmos Model to create a Derivative Model, or use a NVIDIA Cosmos Model or its outputs to create, train, fine tune, or otherwise improve an AI model, you will include “Built on NVIDIA Cosmos” on a related website, user interface, blogpost, about page, or product documentation; and

3.3 You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Models as a whole, provided Your use, reproduction, and distribution of the Model otherwise complies with the conditions stated in this Agreement.

4. Separate Components. The Models may include or be distributed with components provided with separate legal notices or terms that accompany the components, such as an Open Source Software License or other third-party license. The components are subject to the applicable other licenses, including any proprietary notices, disclaimers, requirements and extended use rights; except that this Agreement will prevail regarding the use of third-party Open Source Software License, unless a third-party Open Source Software License requires its license terms to prevail. “Open Source Software License” means any software, data or documentation subject to any license identified as an open source license by the Open Source Initiative (https://opensource.org), Free Software Foundation (https://www.fsf.org) or other similar open source organization or listed by the Software Package Data Exchange (SPDX) Workgroup under the Linux Foundation (https://www.spdx.org).

5. Trademarks. This Agreement does not grant permission to use the trade names, trademarks, service marks, or product names of NVIDIA, except as required for reasonable and customary use in describing the origin of the Model and reproducing the content of the “Notice” text file.

6. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, NVIDIA provides the Model on an “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for reviewing Model documentation, including any Special-Purpose Model limitations, and determining the appropriateness of using or redistributing the Model, Derivative Models and outputs. You assume any risks associated with Your exercise of permissions under this Agreement.

7. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, will NVIDIA be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this Agreement or out of the use or inability to use the Model, Derivative Models or outputs (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if NVIDIA has been advised of the possibility of such damages.

8. Indemnity. You will indemnify and hold harmless NVIDIA from and against any claim by any third party arising out of or related to your use or distribution of the Model, Derivative Models or outputs.

9. Feedback. NVIDIA appreciates your feedback, and You agree that NVIDIA may use it without restriction or compensation to You.

10. Governing Law. This Agreement will be governed in all respects by the laws of the United States and the laws of the State of Delaware, without regard to conflict of laws principles or the United Nations Convention on Contracts for the International Sale of Goods. The state and federal courts residing in Santa Clara County, California will have exclusive jurisdiction over any dispute or claim arising out of or related to this Agreement, and the parties irrevocably consent to personal jurisdiction and venue in those courts; except that, either party may apply for injunctive remedies or an equivalent type of urgent legal relief in any jurisdiction.

11. Trade and Compliance. You agree to comply with all applicable export, import, trade and economic sanctions laws and regulations, as amended, including without limitation U.S. Export Administration Regulations and Office of Foreign Assets Control regulations. These laws include restrictions on destinations, end-users and end-use.

Version Release Date: October 24, 2025
```
